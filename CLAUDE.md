# Claude video toolkit — operating manual

Spec-driven short-video editing with Python + ffmpeg. Every video is a YAML **spec** that the engine
renders; a new video should need a new spec, not new code.

**Two layers.** This repo is the shared engine: code, this manual, templates, sounds, the trends library. Everything
personal lives in **`workspace/`** (git-ignored; `./setup.sh` creates it from `workspace.example/`): the user's brand(s)
(`workspace/brand/<name>/`), video specs (`workspace/history/`), the ideas backlog (`workspace/ideas/`) and
`workspace/CLAUDE.md` (who the user is, their brand, voice and rules), loaded through `CLAUDE.local.md`.
**Read `workspace/CLAUDE.md` first.** Never write brand-specific names, copy or assets into shared files.

## The mantra: every second must earn the next one (read before any idea, script or edit)

Short video is a ruthless attention game, not a film. The viewer swipes the moment nothing pulls them forward, so the
creative has to be bold, fast and a little relentless. Every plan, script and cut passes these:
- **Open a loop in second 1 and close it at the very end.** Every beat raises the next small question (will she find
  it? what's the trick? how fast?), so leaving early feels like missing the answer.
- **Voices perform; they don't explain.** Energy, speed, attitude, comedy: frantic, deadpan, knowing, punchy. Never
  direct a voice as calm, soft, sleepy or reassuring; relief lives in the picture, the voice stays alive. ElevenLabs:
  Stability Creative, energy tags, dashes and full stops (one deliberate "But…" pause at most), ~3.8–4.5 words/s.
- **Escalate.** Each beat faster, louder or funnier than the one before, until the snap (silence, a twist, the reveal).
- **A laugh, a twist or a new picture every few seconds.** No beat may sit still; cut every word and frame that only
  explains. Show it, let the viewer infer the rest.
- **Creative first, safe second.** Pitch the boldest version first; stay careful only on the hard lines (real product
  proof, privacy, no fake numbers or reviews).
- **Made to be sent, not liked.** The viewer should finish feeling smart, with someone in mind to send it to as a
  playful jab ("you didn't know this, did you?"). The video sides with the viewer; the tease is between friends.
- **The test before showing anything:** "Would I stop scrolling for this, would I wait to see how it ends, and who would
  I send it to?" If not, rewrite it before the user has to say so.

## How the user works (read first)

- The user drops the day's files into **`inbox/`**: clips, optionally a voice-over (mp3/mp4/wav), optionally
  style references. They give the brief in chat.
- Voice-overs usually come from an AI voice (ElevenLabs): write narration as a script for it (see Voice-over rules).
  `workspace/CLAUDE.md` says how this user makes theirs.
- The final MP4 goes back into **`inbox/`** (name from the brief, else `<Name>_v1.mp4`; revisions `_v2`, `_v3`...).
- Next day they clear `inbox/` and start again. Specs live on in `workspace/history/`, so old videos can be revised
  once their files are dropped back in.
- The VO may arrive mid-project; then re-time the edit to it (see Voice-over rules).
- **Keep it simple.** No reviewer/verification workflows or multi-agent QA passes for videos. Check your own
  work with contact sheets and stills, report briefly (path, length, notable choices), and let the user
  ask for changes.
- App screen recordings go in the `iphone` layout (drawn iPhone with real corner radii) unless the brief asks
  otherwise; Android recordings (or an audience on Android) go in the `android` layout (drawn Pixel-style phone).

## Daily workflow

1. **Read the brief.** Note required text, timings, output name/place, aspect, platforms. Read the
   brand's notes first (`workspace/brand/<brand>/`: MARKETING.md, product brief; see `workspace/CLAUDE.md`). Read
   the brain (`trends/BRAIN.md` + the pages the job needs) and search it for the brief's format (`./vtk kb search --format pov`);
   say in the plan which proven patterns you are using and why.
2. **Analyse everything** (outputs land in `.work/analysis/`):
   - `./vtk inspect` — every file in `inbox/`: duration, fps (VFR), resolution, iPhone model, audio,
     idle stretches, timestamped contact sheet. Read the sheets (Read tool) to find the useful moments.
   - `./vtk scenes <clip>` for long recordings; `./vtk voiceover <vo> --brand <brand>` for the VO;
     `./vtk audio <music>` for tempo/beats; `./vtk reference <video>` for a style reference.
   - For exact tap/moment times, render a few frames around a moment (ffmpeg or `--frames`).
3. **Show the user a timestamped edit plan and wait for approval**: per section — output time range,
   on-screen text, source clip + in/out + speed, what the viewer sees, sounds. Mention anything cut for
   privacy or quality.
4. **Write the spec** at `workspace/history/<YYYY-MM-DD>_<name>/spec.yaml`. Start from a format template that fits the
   brief (`./vtk new --list`; `./vtk new <name> --template problem-payoff --theme midnight_plum`; the brand defaults to the workspace's)
   or a plain starter (`./vtk new <name> --brand <brand>`). Pick a `theme:` (`./vtk looks --render themes`).
   Run `./vtk validate <spec>` until it's clean; it prints the timeline table and, with a VO, every spoken
   phrase at output time.
5. **Preview**: `./vtk render <spec> --preview` (half-res, same timing, ~2x faster). For quick looks at
   specific moments use `--frames 3.2 8.5 20.1`; `--safezones` draws platform UI zones.
6. **Check the contact sheet** printed after every render (Read it) against the brief: text readable ~2 s,
   nothing important under platform UI, no dead time, proof moments readable, no personal data.
7. **Final render**: `./vtk render <spec>` -> file in `inbox/` + `.srt` (when captioned) + contact sheet +
   loudness report. Renders run in parallel chunks automatically (`--jobs`). Hook A/B tests: declare
   `variants:` and `--all-variants`; other sizes: `--aspect 1:1` / `--sizes`.
8. The spec stays in `workspace/history/` for revisions (commit it in the workspace's own git repo if it has one,
   never in the toolkit repo).

## Standing editing rules

- Find the best moments; never play recordings end to end. Cut pauses, mistakes, waiting, keyboard
  delays and unnecessary navigation (`inspect` lists idle stretches).
- Speed up boring input (typing, form entry) ~1.5–3x; keep the moments that prove how the product works
  (taps, saved results, "found it") at 1x or close, and hold them with `hold:` if the recording ends too soon.
- On-screen text stays ~2 s or longer; one idea per section; key words in the accent colour (`**word**`).
- Respect safe zones (render warnings). Captions/titles in the caption band or the middle, never under
  the bottom caption area or the right action rail.
- Never fake or alter app UI. Framing, zoom, device frame, blur backgrounds are fine; editing UI content is not.
  Covering the iOS recording indicator with the Dynamic Island is fine.
- Privacy: check keyboards (QuickType suggestions can show the recorder's name), notifications, emails,
  phone numbers, share-sheet contact rows. Cut around them, or blur them with a clip's `redact:` (source px).
- Hard cuts by default; crossfade/dip only when it helps. Small punch-ins (1.05–1.25) to focus attention.
- Audio is subtle: music under everything, never overpowering; taps/chimes quiet (-15 to -22 dB).
- Not a corporate ad: native, quick, easy to follow.
- Motion with restraint (2026): one clear phone movement (e.g. a tilt-in `enter` settle), not constant spins;
  whips/zoom-throughs only at section changes (2–3 per video); a flash only on the reveal; no glitch cuts.
  Film grain lives in the background (`look.grain` ≤ 0.05 over app UI). Marks (circles, arrows, highlighter)
  and pop-out `lifts` only on proof moments. At most one emoji per text element.
- Text behind the phone (`text: {behind: true}`), **behind any subject in footage** (`behind: subject`: a hand holding
  the phone, a person, a mug; `behind: person` for people) and glass callout cards add depth without faking UI;
  `lifts` magnify real UI pixels (fine), redrawing app screens is not.

## Voice-over rules

- Scripts are written for ElevenLabs: one generation per section or hook variant (2–3 takes each), beats as
  ellipses and line breaks, a few audio tags for delivery (`[chuckles]`, `[sighs]`). Exact pauses don't matter:
  `place` and `max_pause` re-time every line. A realistic AI voice needs TikTok's AI-generated label.
- The VO sets the timing. Add it to the spec, run `./vtk validate` to get phrase times, then cut each
  section ~0.1–0.2 s before its phrase starts (`section.dur` + `fit:`), matching visuals to what is said.
- `max_pause: 0.35` tightens long silences; `speed:` (pitch-safe, rubberband) only within ±10%.
  Bigger timing changes: ask the user to regenerate the VO.
- Captions come from the VO transcript (`captions:`), synced per word. **Always set `captions.script` to the exact
  narration** (Whisper mishears and punctuates on its own: "send" for "sent", lowercase "share,"); then read every
  caption line `./vtk validate` prints against the script before rendering. Put product names in the brand's
  `vocabulary` (Whisper hotwords) and `caption_replace` for spelling fixes.
- Music ducks automatically under the VO (`duck: -12` dB default). Default loudness -14 LUFS.
- **Fit the VO to the demo, not the demo to the VO.** Anchor lines to screen moments with
  `voiceover.place` (e.g. "Open the app" on the icon tap, "Save" on the Save tap, "There it is" as the
  details open); words between anchors keep the voice's natural rhythm, and each line's trailing silence
  is replaced by the placement gap. Then time shots (`hold_start`, `dur`) so taps land on their words.
  Keep proof taps at 1x; the video may run ~30 s.
- Picking between takes: check every word is there (`./vtk voiceover`), prefer the take whose hook has
  more pitch movement (lively/curious beats flat), and an energetic pace (~3.8–4.5 words/s while speaking).
- Show taps with `taps:` ripples (they also add the tap sound); `pointer: touch|cursor` adds a finger dot / cursor that
  glides from tap to tap, dips on each press, follows drags (`drag:`) and rings on long-presses (`hold:`). Use numbered `step_pill` section text
  ("**1** Add a card") so muted viewers see the flow.

## Folder structure

```
claude-video-toolkit/
  CLAUDE.md            this manual            README.md   overview for engineers   LICENSE   MIT
  vtk                  ./vtk <command> (runs inside .venv; the only entry point)
  setup.sh             one-time setup          requirements*.txt
  inbox/               the user's drop folder (git-ignored): sources in, finished videos out
  workspace/           YOUR files (git-ignored; ./setup.sh copies workspace.example/): CLAUDE.md (your rules),
                       brand/<name>/ (brand.yaml, logo.png, endcard.png, notes), history/ (one folder per video:
                       <date>_<name>/spec.yaml), ideas/ (backlog: ideas.jsonl + IDEAS.md), examples/ (your tests)
  workspace.example/   the starter workspace for a new user
  CLAUDE.local.md      (git-ignored) loads workspace/CLAUDE.md
  examples/            footage-free example specs (demo.yaml: the setup check; kinetic stats, carousel, beat reveal, …)
  tests/               pytest suite (spec validation, frame plan, captions): .venv/bin/python -m pytest
  docs/                getting-started.md (step-by-step setup for beginners), media/ (README images)
  .github/workflows/   CI: pytest + the motion/ TypeScript check on every push
  templates/           format templates for ./vtk new --template (15 native app-marketing formats)
  trends/              the brain: BRAIN.md (read first: golden rules + page guide), brain/<topic>.md (one lesson per line,
                       capped pages), SOURCES.md (every source learned), library.jsonl, archive.md (retired lessons)
  motion/              Remotion (React) motion-graphics looks, rendered as layers (motion/README.md)
  brand/
    default/brand.yaml base brand every brand extends (+ themes.yaml: visual themes)
    fonts/             Google Fonts (restored by ./vtk fonts --sync) + LICENSES.md
    sfx/               generated sounds + sfx.json (peak times)
    plates/            phone plates: hands holding a green-screen phone (README.md: catalog + how to make one)
    music/             drop licensed music here (README.md); generated/ for synthesized beds
  toolkit/             the engine (see "Engine map")
  .work/<project>/     analysis, frames, previews, contact sheets, stems (git-ignored)
  .cache/              proxies, transcripts, generated music (git-ignored; safe to delete)
```

## Commands

| command | does |
|---|---|
| `./vtk inspect [paths]` | default `inbox/`; per file: duration, size, fps + VFR/HDR flags, iPhone model, audio, LUFS, idle stretches, contact sheet |
| `./vtk scenes <clip> [--threshold N]` | scene cuts (PySceneDetect; screen recordings split on screen changes) + idle stretches + sheet |
| `./vtk reference <video>` | shot lengths, cuts/10 s, pacing curve, cut-on-beat %, tempo, loudness, look, where overlays sit, sheets. Learn the style; never copy its content |
| `./vtk audio <file>` | duration, LUFS, peak, tempo, beats, downbeats (bar starts), silences |
| `./vtk voiceover <file> [--brand b] [--model small]` | faster-whisper words + segments -> `.work/analysis/<name>.transcript.json` + `.srt` (cached) |
| `./vtk new <name> [--brand b] [--template t] [--theme th]` | `workspace/history/<date>_<name>/spec.yaml` from `inbox/` sources, optionally from a format template (`--list`) |
| `./vtk validate <spec>` | errors with exact field paths, timeline table, VO phrase times, warnings |
| `./vtk render <spec>` | final render + `.srt` + contact sheet + loudness; `--preview`, `--frames T..`, `--safezones`, `--stems`, `--no-audio`, `--out`, `--variant v` / `--all-variants`, `--aspect 1:1\|4:5\|16:9` / `--sizes`, `--jobs N` |
| `./vtk learn <url\|file> [--note "why"] [--cookies chrome] [--again]` / `--text "..."` | teach the brain (a link learned before is refused unless `--again`): TikTok / YouTube / Instagram video, article link, video / audio / text file, or pasted notes -> analysis (pacing, transcript, hook sheet / text, sound map: spectrogram + loudness + detected build-ups / drops / hits) + draft record for Claude to complete. YouTube videos over 5 min (interviews, podcasts, talks) are learned from their captions + chapters with no download (`transcript.md`; no captions -> audio only through Whisper); `--video` forces the full video, `--transcript` the transcript for any link |
| `./vtk learn <youtube channel url> [--top 60 --recent 10 --picks 6 --refresh]` | channel study: list every Short (titles + views), where the hits are (eras), captions of the top N + newest (text only) -> narration numbers, `transcripts.md`, thumbnail frame sheets (fonts, captions), deep-learn picks, ONE profile draft |
| `./vtk kb [recent [N] \| search <words> \| stats \| show <id> \| commit <id> \| remove <id> \| clean \| export --out f.sql]` | the brain: `./vtk kb` prints BRAIN.md + how full each page is; `recent` lists the newest sources + their lessons; read/search the sources (`--format --kind --platform --tag --since --min-views --min-relevance`), store a completed draft (one line in SOURCES.md; prints the page usage), `clean` slims the cache of committed records, export Postgres SQL |
| `./vtk publish <post.yaml> [--go \| --status \| --metrics \| --retry]` / `--accounts` | post a reel or carousel to the brand's connected accounts through SocialAPI.ai: no flag = upload + validate + save a **private draft** and print what would post; `--go` publishes it (or schedules it); `--status` links → ideas backlog; `--metrics` views/likes/comments/shares/saves → ideas backlog (see "Publishing") |
| `./vtk ideas [show N \| add "title" \| set N k=v … \| remove N \| export --out f.sql]` | the video ideas backlog: board, full idea, add (or `--from idea.yaml`), status / links / metrics, SQL export |
| `./vtk looks [--motion]` | everything available: themes, backgrounds, transitions, animations, easings, marks, text/caption styles, sounds, voice fx, Remotion looks |
| `./vtk looks --render themes\|text\|marks\|transitions\|captions\|motion` | gallery sheet in `.work/looks/` (motion: `.work/motion/catalog.png`) rendered with the real engines |
| `./vtk motion [--id look --props JSON] [--clear]` | Remotion looks: status, render one look to the cache, clear cached renders |
| `./vtk sfx` | regenerate `brand/sfx` (tap, tap_soft, pop, whoosh, swish, swoosh_up, riser, riser_short, chime, chime_soft, impact, boom, click, ding, notify, typing, shutter, glitch, sparkle, bubble, flyby: a 10 s plane passing low overhead, peak at 6 s, stereo left → right; use `align: peak` to land the overhead moment on a beat; cabin_chime: in-flight PA 'bing-bong'; cabin_hum: 12 s jet-cabin hum bed; reveal: dark 'dun… dun' sting, peak on the 2nd stab; cash: register 'ka-ching', peak on the ching; correct / wrong: quiz ding / buzzer; riser_metal: metallic tension riser; scratch: record scratch; flash: camera flash whine → shutter). Quick local narration draft (no ElevenLabs): `say -v "Zoe (Premium)" -r 165 -o line.aiff "text"` |
| `./vtk music --duration 30 [--mood story\|teach\|vlog\|emotional\|energetic --bpm --key --drop --resolve]` | original music bed WAV in a mood (default chill) |
| `./vtk eleven say "text" --voice <name\|id> [--takes 3 --stability creative --model --speed --out stem]` | ElevenLabs voice-over takes straight into the project (`stem_A.mp3`, `_B`…; each with a `.json` of the request); `music "prompt" --duration s` or `--plan plan.yaml` (styles + timed sections, so the music turns where the cut turns) (short beds: a plan came back silent after ~9–11 s, so use a prompt that describes where it builds and drops, then line the drop up with `./vtk audio` downbeats); `sfx "text"`; `voices [--search w] [--library --gender --age --accent --use-case]`, `add <owner> <id> --name`, `models`, `credits`. Key from the Keychain (`security add-generic-password -a "$USER" -s vtk-elevenlabs -w`) or `ELEVENLABS_API_KEY`; never in a file or the chat |
| `./vtk fonts [--sync] [--sample]` | list brand fonts; copy installed Google Fonts in; render `brand/fonts/font_samples.mp4` |

Render speed: ~30 s per 30 s at 1080x1920 on the M4 including audio (5 parallel chunks by default; a moving
phone is drawn once as a sprite and scaled per frame; the first run also builds cached proxies).

## Installed tools

- **ffmpeg 9.0.2** from `homebrew-ffmpeg/ffmpeg` with libass, freetype, fontconfig, harfbuzz, rubberband,
  soxr, x264 (filters: `subtitles`, `ass`, `drawtext`, `rubberband`, `loudnorm`, `sidechaincompress`).
  Not built with zimg: HDR (HLG/PQ) sources are converted without tone mapping (inspect flags HDR).
- ImageMagick 7 (`magick`), `mediainfo`, `exiftool`, `sox`.
- Python 3.11 venv (`.venv`): faster-whisper, scenedetect[opencv], opencv-python, librosa, pyloudnorm,
  Pillow, PyYAML, pysrt, fontTools, numpy. Optional (`requirements-optional.txt`): deepfilternet with
  pinned torch/torchaudio 2.2.2 — installed; `voiceover: {denoise: true}` cleans a noisy VO (cached).
- Whisper model `small` is cached in `~/.cache/huggingface` (downloads use plain HTTPS; xet disabled).
- Node 24 + Remotion 4 in `motion/` (`cd motion && npm install`; renders with headless Chrome, ProRes 4444
  alpha layers cached in `.cache/motion/`). Remotion is free for companies of up to 3 people.

## Fonts (brand/fonts, all SIL OFL)

**TikTok Sans** (TikTok's own overlay font, open-sourced 2025; variable weight 300–900, width 75–150 via
`stretch`, optical size) is the default for every brand. Also: Inter, Inter Display, Montserrat
(var 100–900), Poppins (250–900), Bebas Neue (caps only), DM Sans (var 100–1000), **DM Serif Display** (bold editorial serif titles), Anton, Archivo Black,
Space Grotesk (300–700), Plus Jakarta Sans (var 200–800), Manrope (var 200–800), **Instrument Serif**
(regular + italic: editorial accents), **Space Mono** (typewriter / timers), **Caveat** (handwritten notes),
**Bricolage Grotesque** (var display). Variable fonts also
have static weights for libass. System `SF Pro` works too (Apple's licence limits it to UI mock-ups;
don't use it for marketing). See them: `brand/fonts/font_samples.mp4`.

## Typography: market styles (researched Sept 2026)

What performs in short-form now: TikTok Sans (or Montserrat/Inter 700–800); tall condensed heavy hooks;
one highlighted keyword; native TikTok white "pill" text (reads as native, not an ad). Captions moved on from
the Hormozi look (neon caps + emoji + whoosh on every line now reads as "guru"): clean sans, sentence case,
soft shadow + thin outline, keyword in the brand colour, smooth reveal, 1–3 words (punchy) or 3–5
(tutorial), max 2 lines, ~60–65 % down the frame (`clean`, `reveal`, `bounce`). ALL CAPS only for hooks.
Keep text out of platform UI.

| text style (default brand) | look | use for |
|---|---|---|
| `hook` | TikTok Sans Black condensed (`stretch: 75`), ALL CAPS, 10 px black outline, accent keyword | 0–3 s hook; stack short lines (`YOUR\nNOTES\nAREN'T A\n**PLAN.**`) |
| `hook_anton` | Anton, caps, outline, yellow keyword (Hormozi/MrBeast energy) | louder hooks |
| `title` / `endcard_title` | TikTok Sans Black, slightly condensed, shadow | end cards, big statements |
| `native_pill` = `caption_top` | black TikTok Sans Bold on white rounded pills, keyword on an accent chip | section text above the phone |
| `caps_stroke` | Montserrat Black caps, outline, yellow keyword | punchy one-liners |
| `step_pill` | native pill with the step number on a round accent chip (`"**1** Add a card"`) | how-to steps |
| `cta` / `cta_accent` | soft line + `**Try X.**` on an accent chip (sticker-like button) | end-card CTA |
| `body`, `label` | clean body text; dark label box | small notes |
| `kinetic` | hook font, caps, outline — made for `text_anim: {by: word, effect: stamp\|pop}` | kinetic hooks, text behind the phone |
| `clean_title` | TikTok Sans 800, sentence case, soft shadow | calm titles, stat labels |
| `editorial` | sans + **Instrument Serif italic** accent word with a hand-drawn underline that draws on | premium / explainer lines |
| `neon` / `gradient_title` / `outline` | glowing text / white→accent gradient caps / giant stroke-only type | energy, big numbers behind content |
| `highlight` | accent words get a highlighter sweep drawn *under* them | one keyword per section |
| `strike` | `~~old~~ **new**`: with word animation the old word is crossed out, dims, then the new word pops | "Plan with ~~spreadsheets~~ **one app.**" |
| `word_pills` / `sticker` | each word on its own white pill / caps on an accent sticker | native captions, ratings |
| `glass_card` | frosted-glass card (blurred backdrop, 14 % white, bright hairline) | callouts over real UI |
| `liquid_glass` | iOS 26 liquid glass pill (`box.mode: liquid`): the picture behind stays sharp and bends at the rim with chromatic edges + a rim light (`bezel`, `refract`, `shine`, `blur`) | a label or toolbar over photos / footage |
| `typewriter` / `timer` / `counter` | Space Mono on a dark box / mono digits / huge condensed number | typing hooks, call timers, stats |
| `stat` / `stat_label` / `plain_title` | big geometric number, `**54%**` gets a straight marker underline in the accent / its label / medium sentence-case line, no shadow | kinetic stat explainers (theme `kinetic_light`) |
| `handwritten` / `mark_label` | Caveat marker note / small white label pill (used by mark labels) | annotations |

| caption style | look |
|---|---|
| `tiktok_native` (= `standard`) | white pills, current word on an accent chip, pop-in |
| `hormozi` (= `bold_center` at centre) | Montserrat Black caps, thick outline, current word yellow, 1–3 words |
| `word_highlight` | TikTok Sans bold, outline, current word in the brand accent |
| `clean` (2026 default) | TikTok Sans 700, sentence case, thin outline + soft shadow, keyword in accent, slide-in, at 63 % |
| `reveal` / `bounce` | `clean`, but words appear as they are spoken / the current word bumps up |
| `bold_caps` | Remotion-TikTok look: 104 px caps, heavy under-stroke, active word green `#39E508` |
| `minimal` / `neon_caption` / `word_boxes` | small lowercase / glowing / every word on a pill, current on the accent |

Style keys: `family`, `weight`, `stretch` (font width 75–150), `size`, `case`, `color`, `accent`,
`accent_box` {color, pad, radius} (chip behind `**accent**` runs), `box` {mode: block|line}, `stroke`,
`shadow`, `highlight` (current caption word, optional `box`), `line_height`, `letter_spacing`,
`max_width`, `align`, plus `accent_font` {family, italic, weight, size} (e.g. serif italic accent words),
`accent_mark` {type: underline|circle|highlight|box|strike, delay, draw, width, color} (drawn on the accent
words), `glow` {color, blur, strength}, `gradient` [colors], `fill: none` (outline text), `box.mode: word|glass`,
`strike_color`, `extrude` {depth, color, color2, angle, outline {width, color}} (3D block letters; e.g. orange
gradient face + dark extrusion + black outline = the 2026 "MARKETERS" look). Markup: `**accent**`, `~~strike~~`, `==marker==`, `__underline__`, `[[img:mybrand/logo.png]]`
(inline image), colour emoji (Apple Color Emoji). Caption styles take `anim: pop|bounce|reveal|fade|slide|none` (`zoom:` = how far the spoken word grows with `bounce`, default 0.16); text styles take `word_spacing` (extra gap between words, em) so a highlighted, zooming word never covers its neighbour.

## What works now (research Sept 2026: TikTok Creative Starter Pack + Creative Codes, Meta Reels guide, Socialinsider, OpusClip, Buffer)

- **Hook**: under 2 s for apps; outcome first ("Your flight's gate in 2 taps"), a number, a direct command or
  a recognisable moment. Script it as context lean → "But…" → contrarian snapback, with the payoff proven on screen
  (`trends/brain/hooks.md`). Never open with the app name or a logo. Hook text 6–10 words, full size on frame 0,
  inside the 3:4 profile-grid crop, and spoken by the VO too.
- **Structure** (TikTok's own): hook 0–3 s · setup 3–6 · body 6–15 · reveal 15–20 · CTA 20–25. Brand TikToks
  15–30 s had the best engagement; Reels 30–60 s the best reach. Single-feature demos 20–35 s.
- **Pacing**: a visual change every 1.5–3 s (3–6 per 10 s); proof moments 1.5–2.5 s at 1x; punch-ins 10–15 %
  on alternating shots; auto-zoom onto each interaction is the standard product-demo look.
- **Loops**: end on a frame that matches the start (`output.loop`), no fade to black, end card ≤ 1–1.5 s.
- **Sound**: TikTok is sound-on; effects only on 3–5 key beats; taps -18 to -24 dB; whooshes only at section
  changes; one riser into the reveal; soft chime on "saved"; typing clicks for typing. Business accounts:
  original audio (VO + our generated bed) or the platform's commercial library; never chart songs.
- **Sound job map** (use it when planning every video's sound): attention / "wait, what?" → `scratch` · a statement that
  must land → `boom` / `impact` under the key word · comedy (after the punchline) → `boom` · something unexpected revealed
  → `reveal` ("dun… dun", `align: peak`) · suspense / tension → `riser` or `riser_metal` (`align: end`) cut dead into the
  payoff word · hype right before the payoff → `impact` · a pop-up / card / sticker → `pop` + `click` · section change →
  `whoosh`; a white `flash` transition → `flash` (`align: peak`); `glitch` only for a deliberate tech beat · quiz,
  myth vs fact, right vs wrong way → `correct` / `wrong` · money, price, savings, "free" → `cash` (`align: peak`).
  One job per sound, 3–5 per video, never two on the same beat. Music by the video's job: `generate: {mood: …}` (story,
  teach, vlog, emotional, energetic) or the platform's commercial library in that mood.
- **Formats that work for faceless apps**: hook + demo, numbered list, POV chaos → calm, group-chat story, kinetic stat
  explainer (one literal graphic per fact, numbers counting in, metaphor ending; no footage needed),
  "things I wish I knew", before/after split with timers, 6-slide story, reply-to-comment (use the native
  reply sticker; never fake a comment), screenshot explainer, "rating X", day-in-the-life → `templates/`.
- **Fading**: Hormozi neon captions, constant ALL CAPS, glitch/flash on every cut, logo openers, over-polished
  ad look, watermarks, near-identical templated uploads (vary structure, not only text), stock AI voices
  (generic narrator presets; use a natural conversational ElevenLabs voice).
- Label realistic AI media where the platform requires it (TikTok); an AI narrator may count.

## AI scenes (Google Flow) + phone plates

Story hooks can open on AI-generated places (Google Flow), then hand over to the real app inside a phone plate.
- **Claude drives Flow** in the built-in browser after the user signs in (never an unofficial Flow MCP). Agent/prompt
  settings: images 9:16 Nano Banana Pro (0 credits), video 9:16 x1 Omni Flash (~15 credits / 10 s, 720p; download
  1080p upscaled). Confirm before generating stays on. Downloads land in `inbox/`; move paid clips out of `inbox/` into
  the brand's folder (e.g. `workspace/brand/<brand>/broll/`) so clearing the inbox never loses them.
- **Stills first, video only for approved shots.** Places, objects and hands; no faces, no talking mouths. Small motion
  (push-in, flicker, pen tap, phone turned to camera) reads as real. Text lives in our engine; AI renders only 1–2
  words that belong in the scene (a sign, a form label). Never an AI app screen.
- **The bridge:** an AI shot of a phone turning to camera with a white screen, then a `flash` transition into the plate
  layout, makes the app part of the story. Phone plates (`brand/plates/`) are stills: steady, reusable, free.
- Realistic AI picture or voice -> the platform's AI-generated label. The brain's strategy page has the credit lessons.

## Publishing (SocialAPI.ai)

`./vtk publish` posts finished work through [SocialAPI.ai](https://docs.social-api.ai) (one API for Instagram, Facebook,
TikTok, YouTube, Threads, LinkedIn, X). LinkedIn: `linkedin` posts as a member profile, `linkedin_page` as a company /
showcase page (SocialAPI beta: their support enables it per account, then connect the page in the dashboard). Setup once: the brand's `brand.yaml` gets
`publish: {provider: socialapi, brand_id: <SocialAPI brand id>, platforms: [instagram, tiktok, youtube, facebook, threads]}`,
and the API key goes into the macOS Keychain (`security add-generic-password -a "$USER" -s vtk-socialapi -w`; or the
`SOCIALAPI_KEY` env var). Never put the key in a file, a spec or the chat.

Each post is a `post.yaml` next to the video's spec (`workspace/history/<date>_<name>/post.yaml`):

```yaml
media: Launch_v3.mp4                # a video (reel), a list of images or a rendered `<name>_carousel` folder (carousel,
                                    #   2-10 on IG; JPEGs made for you)
caption: "Your gate changed. Your phone knew first. ✈️ #travel"
title: "Your gate changed. Your phone knew first" # YouTube title (max 100); default: the caption's first line
captions: {threads: "short version (500 max)"}   # per-platform text overrides
platforms: [instagram, tiktok, youtube, facebook, threads]   # default: the brand's publish.platforms
ai_label: true                      # realistic AI voice / picture: TikTok is_aigc, IG AI label, YouTube synthetic media
cover: 0.0                          # seconds into the video for the cover frame (frame 0 = the hook)
first_comment: "…"                  # IG / FB / YouTube
schedule: 2026-10-10T18:30:00+05:30 # optional: schedule instead of posting now on --go
idea: 27                            # ideas backlog: status, posted date, links and metrics are written back
tiktok: {privacy_level: PUBLIC_TO_EVERYONE}   # raw per-platform overrides (instagram: {content_type: stories}, youtube: {...})
```

**The two-step rule:** `./vtk publish post.yaml` only uploads, validates and saves a private draft (free, visible in the
SocialAPI dashboard). Show the user its printout (platforms, caption, title, labels, time) and run `--go` only after they
say yes in chat, per post or as one explicitly listed batch. YouTube takes videos only (carousels skip it); TikTok
carousels are photo mode. After posting: `--status` (links into the backlog), and `--metrics` a day or a week later.

## Video ideas backlog (workspace/ideas/)

`workspace/ideas/ideas.jsonl` holds the ideas (one per line). `workspace/ideas/IDEAS.md` is the board, regenerated on every change.
Never hand-edit the board.

- **User asks for new ideas (any words: "new idea", "what should we post", "give me 3 ideas"):** learning is for
  using. First read `trends/BRAIN.md` + the strategy, formats and hooks pages, run `./vtk kb recent` (the newest
  sources and what each taught) and read the brand's notes (its own learned lines, e.g. MARKETING.md). Every pitched
  idea ends with **"Uses:"** naming the 2–3 learned lessons it is built on (page + source id, newest first when they
  fit). An idea that uses nothing we learned is not ready to pitch. Learning a link never changes an existing video
  by itself; the next idea is where it shows up.
- **User says "add an idea …":** run `./vtk ideas add "title" --hook … --format …`. For a full idea, write a YAML
  (hook, pain, proof, feeling, beats [{t, show, say}], narration, recordings, caption, cta, planned) and pass
  `--from file.yaml`.
- **User says "let's do idea #N":** `./vtk ideas show N`, then read the brand's notes
  (`workspace/brand/<brand>/`) and the brain (`trends/BRAIN.md` + strategy, formats, hooks pages) and groom it. Keep the status current:
  `./vtk ideas set N status=groomed|recording|editing|ready|posted spec=workspace/history/<date>_<name>/spec.yaml`.
- **After posting:** `./vtk ideas set N status=posted posted=<date> links.tiktok=<url> metrics.views=…` (also likes,
  shares, saves, comments). What performs feeds the next ideas.
- `./vtk ideas` prints the board; `./vtk ideas export --out ideas.sql` exports it for the VPS (table `video_ideas`).

## The brain: trends knowledge base (trends/)

The user shares what they find so the toolkit keeps getting smarter: TikTok / YouTube / Instagram links, screen
recordings, audio (voice notes, podcast clips, sounds), article links, text files or pasted notes
(`./vtk learn --text "..."`), hundreds or thousands over time. Scope: **video craft + app marketing**. The goal is a
brain that gets sharper with every source, not a pile of notes: **distil, don't collect.**

**What the brain is (all plain text files, shared with everyone who uses the toolkit, so no brand names in them):**
- `trends/BRAIN.md`: read first, before planning, grooming or scripting any video: the golden rules (the lessons proven
  most often) + which topic page to open for which job. Max 40 lines.
- `trends/brain/<topic>.md`: one page per topic (hooks, narration, structure, formats, text, motion-sound, product-cta,
  strategy, fading, to-build). **One lesson per line**: the lesson, *why*, the tool to use, proof `[views: source id]`
  (short ids work: `./vtk kb show lmxpbp`). Max 80 lines per page. A job opens BRAIN.md + only the pages it needs
  (scripting: hooks + narration; editing: structure + text + motion-sound; grooming: strategy + formats + hooks).
- `trends/archive.md`: retired or merged-away lessons, dated (never read when planning).
- `trends/library.jsonl`: one entry per source: what it taught (`lessons`), which brain lines it backed up (`confirms`),
  the pages it fed. Full notes (beats, craft, insights) only for special sources (`keep: full`: a format we may copy
  beat by beat, a channel study). Searched (`./vtk kb search`), never read whole; `./vtk kb export` makes a Postgres file.
- `trends/SOURCES.md`: generated list of every source learned, newest first, one line each. Never edited by hand.
- `./vtk kb` prints BRAIN.md and how full each page is.

**For every link (the loop):**
1. `./vtk learn <url> --note "<their words>"`. A link learned before (same video, any URL form) is refused with what
   it taught; only `--again` re-learns it. Many links at once: learn them one by one, then report once.
2. Watch / read it fully: the hook sheet, the contact sheet, the **sound map** (spectrogram + loudness + speech + cuts,
   with detected build-ups / drops / hits: what the sound does besides the words; the sound often carries half the
   format) and the transcript. Talks (interviews, podcasts): `transcript.md`, chapters are its headings.
3. Compare with the brain (BRAIN.md + the pages it touches; `learn` also prints the closest past sources) and decide:
   - **New lesson** -> one new line in the right page (generic words: what any app could use).
   - **Confirms a lesson** -> add this source as proof on that line, no new line; keep the 3 strongest proofs and a
     count (`[4.9M: as7abw; 1.2M: x7k2; +5]`). Bigger numbers and newer sources outrank old ones.
   - **Contradicts a lesson** -> move the old line to `fading.md` with the new evidence (later to `archive.md`).
   - **Nothing new or off-topic** -> say so; relevance 1–2.
4. Fill the draft (`.cache/trends/<id>/draft.yaml`): `kind` (app_marketing | trend_format | craft_reference),
   `format`, `relevance` (1-5 for faceless app marketing), `lessons` (the new lines, short), `confirms` (the lines it
   backed up, as `page: lesson`), `pages`, `tags`; `keep: full` only for a special source, then also `hook`, `beats`,
   `craft`, `marketing`, `insights`, `why_it_works`, `steal` (generic), `engine` (template, features, gaps).
5. `./vtk kb commit <id>` (validates, adds the line to SOURCES.md, deletes the download). Tool gaps go to `to-build.md`.

**Keeping it sharp:** a page over its cap -> merge lines that say the same thing, archive the weakest or oldest. When
many sources prove the same lesson, promote it to the golden rules in BRAIN.md (and demote the weakest rule). Recent,
bigger-number evidence outweighs old; no dated "update" blocks, everything sits under its topic.

- **Whole channels** (a creator with hundreds of Shorts): `./vtk learn <channel url>` instead of one by one. Read
  `transcripts.md` (every sampled script + medians) and the frame sheets, optionally `./vtk learn` 2–6 of the picks for
  pacing and sound, then fill ONE profile record (`hook_bank`, `insights` with numbers, `steal`, `lessons`, `pages`;
  always kept in full). Its lessons go into the topic pages, not a creator section. YouTube shows a "confirm you're not
  a bot" wall after many requests in a row (downloads too, for an hour or more): the study reads 2 at a time and stops
  at the wall; thumbnails still work. Don't reach for the user's browser login (`--cookies chrome`) without asking.
- **Shared links are for learning only.** The user shares YouTube videos / Shorts / Reels at random, across sessions.
  Never change a video, spec or render because of one unless they ask.
- **Then fit it to the user's brand** (`workspace/CLAUDE.md` names it and its goal). If it helps, update the brand's
  notes (e.g. its MARKETING.md hook bank) and the ideas backlog (a new idea or a better hook for an existing one): brand
  plans go to the workspace, never into the shared brain. Some shared videos have nothing to do with the brand: keep
  only the transferable craft, set `relevance` 1–2, say so, and don't force brand changes.
- **References are raw material, not templates.** The user shares them so our ideas get more original, not to copy
  them. Name the mechanism (why it holds attention: a promise, a clock, a game, a contrast, a sound) and rebuild it
  around a truth about the product and a real moment from the audience's life, planning sound and picture together
  (sound can be the clock, the progress or the twist). Every idea must hold 30 s (hook + foreshadow, something to wait
  for, the payoff last) and leave the viewer something: a tip, a self-test, a laugh, relief.
- **Report briefly, in plain words:** new vs already known, the main takeaway, what changed in the brain (which page)
  and for the brand (or "nothing new" / "nothing for the brand").
- Instagram usually needs the user's browser login: `--cookies chrome` (or safari). YouTube uses Node as the
  JavaScript runtime (yt-dlp + yt-dlp-ejs). Learn patterns, never reuse other creators' footage or copy their content.

## Spec reference

Units: times in seconds. Sizes/positions are design px for a 1080-wide 9:16 frame (scaled for other
aspects) or `"NN%"` of the frame. Relative file paths resolve against `inbox/` (sources also against
`workspace/brand/` and `brand/`, so reusable plates live in `<brand>/plates/`; overlay images also against the spec folder).

```yaml
version: 1
name: myapp-launch                     # project name (defaults to the folder name)
brand: mybrand                         # workspace/brand/<name>/brand.yaml (or the engine's default)
output:
  file: MyApp_Launch_v2.mp4           # relative -> inbox/
  aspect: "9:16"                       # 9:16 | 1:1 | 4:5 | 16:9   (or width/height)
  fps: 30
  loudness: -14                        # LUFS; brand default if omitted
  platforms: [tiktok, reels, shorts]   # safe-zone checks (default for 9:16)
  crf: 16                              # x264 quality; preset: slow
  fade_in: 0.0                         # optional video fade from/to black
  fade_out: 0.0
sources:                               # name -> file
  add: 01_add_card.mov
defaults:                              # apply to every section/clip unless overridden
  layout: iphone                       # iphone | android | card | fullbleed | fit  (auto if omitted: iPhone
                                       #   recordings -> iphone, 20:9 Android -> android, wide -> fit, else fullbleed)
  transition: cut
  background: {type: blur, dim: 0.6, tint: tint}
  text_style: caption_top              # section text style
  text_pos: caption_band               # named position or [x, y]
  text_anim: {in: 0.26, rise: 16, out: 0}

timeline:                              # sections play in order; clips inside play in order
  - section: add-card                  # name (for tables/warnings)
    text: "Start with **one card.**"   # shown for the whole section; **x** = accent; \n = new line
                                       # or {content, style, pos}; "none" for no text
    text_style: caption_top
    text_pos: caption_band
    text_anim: {in: 0.26, rise: 16}    # entrance (fade + rise px); out: fade at the end
    dur: 5.0                           # optional target length (e.g. from VO phrase times)
    fit: hold                          # if clips are shorter: hold (freeze) | extend (play on); longer: trimmed
    layout: iphone                     # section default
    clips:
      - src: add                       # a source...
        in: 0.95                       #   source in-point
        out: 2.55                      #   ...or dur: output seconds (exact frame counts)
        speed: 2.0                     #   constant, or
        ramp: [[1.0, 1], [1.5, 3], [2.4, 1]]   #   [source_time, speed] keys (smooth)
        hold: 1.2                      #   freeze the last frame (hold_start: freeze the first)
        id: saved                      #   optional name
        transition: {type: crossfade, dur: 0.25}   # into this clip: cut | crossfade (overlaps) | dip {color}
        enter: {rise: 90, dur: 0.28, fade: 0.35}  # phone/card slides up + fades in
        camera:                        # keyframes, eased; t = seconds into the clip
          - {t: 0.25, zoom: 1.0, focus: [660, 300]}
          - {t: 0.95, zoom: 1.1, focus: [660, 300], pan: [0, -20]}
        zoom: [1.0, 1.05]              # shorthand: start/end zoom over the clip (with focus:)
        dim: 0.3                       # darken 0-1      vignette: 1.0
        layout: {type: iphone, style: full, height: "47%", center_y: "74%"}
        background: {type: blur, dim: 0.66, tint: tint}   # | {type: color, color} | gradient {top, bottom} | image {file}
        sfx: [{sound: tap, src: 7.60, volume: -15}]       # src = source time (or at: seconds into clip)
        taps: [{src: 7.60, pos: [1150, 345]}]              # touch ripple at source px + tap sound (sound: none, volume);
                                       #   hold: 0.7 = long-press (ring), drag: [x, y] (+ drag_dur) = press here, let go there
        pointer: touch                 # touch | cursor | {style, size, color, enter, exit, travel, ring}: a finger dot or a
                                       #   cursor drives the taps (glides between them, dips on press); also section/defaults
        audio: -6                      # include this clip's own audio (true or dB); constant speed only
      - still: {src: find, at: 1.25}   # freeze frame from a clip (end cards)
        dur: 3.0
      - image: poster.png              # an image file
        dur: 2.0
      - color: "#111117"               # plain colour card
        dur: 1.0
    overlays:                          # times relative to the section start
      - {text: "Less typing.\nMore doing.", style: endcard_title, pos: [center, 586], start: 0.08,
         fade: [0.4, 0], rise: 22}     # end/dur optional (default: section end); anchor: center|top|bottom|left|right
      - {image: mybrand/logo.png, size: 132, pos: [center, 330], fade: [0.35, 0], rise: 18, opacity: 1}

overlays: []                           # same as above but absolute times

captions:                              # from the voice-over transcript
  from: voiceover
  style: word_highlight                # standard | bold_center | word_highlight (brand caption_styles)
  pos: caption_band                    # default from the style
  max_words: 4                         # per chunk (chunks split at punctuation/pauses, balanced)
  max_chars: 24
  offset: 0.0                          # shift captions (s)
  replace: {"Acme app": "AcmeApp"}     # spelling fixes (brand caption_replace also applies)
  skip: [hook]                         # sections without burned-in captions (the hook text already shows the words);
                                       #   the .srt keeps every word
  skip_text: ["No app does it like this"]   # hide the caption chunks of these spoken phrases (their words are
                                       #   already on screen as text/headers); matched case- and punctuation-insensitively
  script: "Share. Mail. Sent."         # ALWAYS set it: the exact spoken text. Captions show the script's spelling, capitals
                                       #   and punctuation; Whisper only times the words (misheard words take the timing of
                                       #   the heard word that sounds most like them; words start where the voice is audible)

audio:
  voiceover: {file: vo.mp3, start: 0.3, max_pause: 0.35, speed: 1.0, volume: 0, trim: [0, null], language: en,
              denoise: false,          # denoise: DeepFilterNet clean-up for noisy recordings (not needed for ElevenLabs)
              cut: [[8.5, 12.2]],      # drop ranges (seconds of the file), e.g. a line; its words leave the captions
              place: [{text: "Open the app", at: 4.45}, {text: "There it is", at: 25.55}]}   # anchor lines to output times
  # hook A/B/C from separate takes: the main VO for A; a variant sets voiceover.trim past hook A, plays its own hook
  # as a track (tracks: [{file: hookB.mp3, at: 0}]) and restates `place` shifted by its longer/shorter hook
  music: {file: bed, volume: -6, fade_in: 0.2, fade_out: 1.2, start: 0, offset: 0, duck: -12, loop: true}
  # or generated: music: {generate: {mood: teach, key: D, drop: 3.0, resolve: 27.0, seed: 7}, volume: -4}
  #   mood (sets tempo, mode, drums, bass, lead; bpm overrides): chill (default chill-pop 120) · story (84, minor, no
  #   drums, pads + sparse piano) · teach (92, soft beat under the voice) · vlog (88, warm groove, heavy bass) ·
  #   emotional (72, solo piano) · energetic (140, trap hats + 808). Pick by the video's job (brain: motion-sound)
  sfx:
    - {sound: whoosh, at: 3.0, align: peak, volume: -10}   # align: start | end | peak ; pan: -1..1
```

**Motion & effects (2026 upgrade)** — all optional, all validated:

```yaml
theme: midnight_plum                   # visual theme (brand/default/themes.yaml): background, colours, styles, look, motion defaults
look: {grain: 0.04, vignette: 0.2, contrast: 1.03, saturation: 1.05, warmth: 0.1, lift: 0.02, bloom: 0.1, sharpen: 0.4, chroma: 1}
output: {loop: {dur: 0.4}, srt: true}  # loop: crossfade the tail into frame 1; srt: write <output>.srt from the captions
output: {aspect: "4:5", carousel: {format: jpg, at: 0.95, quality: 93}}   # carousel: one still slide per section instead
                                       #   of a video -> <output>_carousel/<name>_01.jpg ... (exit fades off, the finished
                                       #   state); a section's `slide_at:` (seconds) picks another moment; give motion looks
                                       #   `outro: 0`, use cuts. Template `carousel`, demo examples/carousel_demo.yaml
defaults: {drift: 0.03, enter: {rise: 100, dur: 0.55, ease: spring_soft, tilt: [12, -8], scale: 0.93}}   # every clip
defaults: {motion_blur: 1}             # motion blur on every animated text / overlay (or per element: anim.motion_blur,
                                       #   text_anim.motion_blur; 0.5 subtle, 1 = a full-frame shutter): whips smear along
                                       #   their path, mega slams and grows get zoom streaks, crisp the moment they settle
variants:                              # hook A/B tests: section-name -> field overrides (+ theme/look/output/audio/captions);
                                       #   `section: null` drops that section in the variant
  quote: {hook: {text: {content: "“Where did I **save that?**”"}}}
timeline:
  - section: hook
    beats: 4                           # dur from the music tempo (4 beats), instead of dur:
    text: {content: "YOUR NOTES\nAREN'T A **PLAN.**", style: kinetic, pos: upper_third, behind: true}   # drawn behind the phone
    # behind: subject -> behind whatever Vision finds in front (hands + phone, a person, an object); behind: person
    # -> people only. Works on any layout (fullbleed b-roll, plates, camera footage); overlays take `behind:` too
    text_anim: {by: word, effect: stamp, stagger: 0.1, in: 0.28, ease: spring, out: 0.2, out_effect: fade,
                caret: false, line_delay: 0, sfx: pop, delay: 0}   # by: block|word|letter|line; effect: any animation preset;
                                         #   delay: seconds before the text enters (land it on a reveal's hit: delay = lead)
    clips:
      - src: find
        in: 0.9
        dur: 2.2
        enter: {rise: 260, dur: 0.9, fade: 0, ease: spring_soft, tilt: [24, -18], rotate: -5, scale: 0.86}  # 3D settle
        camera: [{t: 0, zoom: 1.0, tilt: [0, 0], rotate: 0}, {t: 1.5, zoom: 1.08, tilt: [6, -4], ease: in_out}]
        tilt: [[10, -8], [0, 0]]         # shorthand: start/end 3D tilt (degrees: x = top away, y = right side away)
        drift: 0.05                      # slow push-in when there is no camera; consecutive clips showing the same phone /
                                         #   card / fit frame in a section share ONE push-in across the cuts (no snap back);
                                         #   `drift: 0` on UI walkthroughs with small text (slow zooms step after re-encoding)
        autozoom: true                   # push in on each tap (1.15x iphone / 1.35x card), pan between close taps, release;
                                         # {zoom, lead, hold, release, keep_top}; also in defaults/section
        transition: {type: zoom, dur: 0.3, pos: auto, sfx: auto}   # zoom-through into the last tap of the previous clip
        reveal: {shape: circle, count: 5, pattern: row, lead: 0.28, burst: 0.2, grow: 0.75, base: "#05020A"}
                                         # beat-edit shape reveal (CapCut style): the clip shows only through shapes on a
                                         #   plain base: they gather into one in the dark for `lead` s (put that on the
                                         #   song's gap), burst into many on the hit (motion-blurred), balloon to the full
                                         #   picture over `grow`. shape: circle|square|squircle|diamond|star|hexagon|triangle|
                                         #   heart; pattern: row (angle)|ring|grid|scatter (seed)|one; size, zoom (1.06 ->
                                         #   1.0 settle), rotate, gather: false (one shape pops in). base: stage = the `gap`
                                         #   colour until the hit, then the clip's own background snaps in and only the
                                         #   phone / card bursts in (light stages: text lands on the stage, not on black).
                                         #   On a section: its first clip. Start each section `lead` s before its bar and
                                         #   give its text `delay: lead`
        marks:                           # drawn-on annotations pinned to source px (follow camera + tilt)
          - {type: circle, rect: [84, 1950, 260, 70], src: 5.4, draw: 0.5, dur: 2.0, color: accent, label: "Booking ref", label_side: top}
          - {type: arrow, rect: [700, 1950, 520, 70], at: 1.1, side: right, length: 150}
          - {type: highlight, rect: [84, 2160, 250, 66], at: 1.6, opacity: 0.5}
        redact:                          # privacy: blur | pixelate | fill a source rect (follows layout, camera, plate warp)
          - {rect: [0, 590, 1320, 480], src: 11.10, dur: 2.0, style: blur, strength: 30, radius: 0}   # no src/at: whole clip
        lifts:                           # pop-out: real UI region lifts off the screen, scales, holds, returns
          - {rect: [50, 1836, 1220, 434], at: 2.2, in: 0.45, hold: 1.2, out: 0.3, scale: 1.18, up: 60, dim: 0.35,
             radius: 44, border: accent, exit: return}
      - {motion: stat-counter, dur: 2.5, props: {from: 0, to: 118, format: percent}}   # Remotion look as a clip
  - section: memories                  # beat montage (CapCut "beat edit"): expands into clips cut on the music's beat
    montage: {items: [mybrand/screens/home.jpg, {src: rec, in: 2.0}, ...], beats: 1, intro: 2, grid: 4,
              speedup: 0.5, layout: fullbleed, flash: true}   # intro boxes grow to full, a 2x2 grid builds per half
                                       # beat, the last part cuts twice as fast; tempo from audio.music (bpm / mood)
      - {color: transparent, dur: 2.0}   # show only the (theme) background: for full-screen text / overlays
    overlays:
      - {text: "time to find it", style: body, pos: [50%, 64%], start: 0.4, anim: rise}          # anim preset
      - {text: "hi", anim: {in: pop, dur: 0.4, out: fade, out_dur: 0.3, ease: spring, idle: float, by: word}}
      - {text: "~~cookies~~ **sewing kit**", style: strike, anim: {in: pop, by: word, stagger: 0.07, strike_at: 0.15}}  # strike_at: when the cross-out starts
      - {text: "TAKING CARE OF FAMILY", style: hook, anim: {by: word, sync: voice, zoom: 0.15}}   # every word on screen from
                                       #   the start (a cover); each zooms in and settles while the voice-over says it
                                       #   (matched to the transcript at or after the element's start; needs captions:);
                                       #   pop: spring = it pops past `zoom`, holds while said, settles; upcoming: 0.45 =
                                       #   words not said yet dim to 45 % once the voice reaches the text (frame 0 stays lit;
                                       #   upcoming_at: seconds after the element starts, to dim several lines together);
                                       #   neighbours slide apart while a word grows, a line never grows past the frame
      - {counter: {from: 227, to: 12, format: time, dur: 1.4, delay: 0.3}, style: timer, pos: [50%, 55%], anim: pop}
      - {counter: {text: "{} to {}", values: [[29, 25], [49, 44]], dur: 1.0}, style: stat, anim: {in: whip_left, motion_blur: 1}}
                                       # several numbers counting at once: one {} per [from, to] pair
      - {text: "**54%**", style: stat, pos: [42%, 48%], anim: {in: mega, dur: 0.5, out: whip_left, motion_blur: 1}}  # giant slam-down
      - {mark: {type: circle, rect: [300, 860, 480, 110], draw: 0.45, delay: 0.2}}               # design px
      - {mark: {type: arrow, from: [260, 1250], to: [520, 980]}}
      - {video: ins, in: 2.0, speed: 2.0, layout: {type: iphone, width: 400, pos: [28%, 57%]}, anim: {in: slide_up}}  # picture-in-picture
      - {video: find, layout: {type: card, width: 420, radius: 36, border: accent, pos: [72%, 57%]}}   # card | circle | iphone;
                                       #   card `shadow: false` (or 0-1) = a flat panel that blends into a flat stage
      - {motion: emoji-burst, start: 1.2, dur: 1.5, props: {emojis: ["😭", "🔥"]}}                  # Remotion look as a layer
      - {image: mybrand/logo.png, size: 150, pos: [50%, 12%], anim: {in: stamp, idle: float}, shine: {at: 0.8, dur: 0.7}}
audio:
  voiceover: {file: vo.mp3, fx: phone}  # voice effects: phone | small_speaker | radio | walkie | megaphone | cabin (aircraft PA) | reverb | hall | underwater | whisper
  music: {file: bed.mp3, bpm: 118}      # bpm for beats: on file music (generated music knows its tempo)
  tracks:                               # any extra audio: other voices, ambience, a phone call
    - {file: friend_line.mp3, at: 0.6, fx: phone, volume: -2, fade_in: 0.02, fade_out: 0.1, trim: [0, 3.2], duck: -8}
    - {file: cafe_ambience.wav, at: 0, dur: 9, loop: true, volume: -22}
```

| feature | options |
|---|---|
| themes | `deep_space` (navy stage, purple halo, stars) · `neon_glow` · `airy_light` (lavender mesh, dark text) · `editorial` (paper, serif italic, grain) · `sunset_mesh` · `electric` (grid) · `aurora` · `clean_white` · `bold_pop` (rays, stamps) · `lofi` (grain, typewriter) · `midnight_plum` (plum night + teal) · `kinetic_light` (flat light grey, ink type, accent marker, every move whips in/out with motion blur: stat explainers; give the hook `text_anim: {effect: none}` so frame 0 is full). Light themes use the brand's `accent_dark` for text |
| backgrounds (`background.type`) | `blur` · `color` · `gradient` · `image` · `mesh` {colors, base, speed, size} · `glow` {color, accent, accent2, glows, stars, pulse} · `paper` · `grid` · `dots` · `rays` {color, color2, count} · `aurora` {colors} · `noise` {grain} · `spotlight` · `polar` {blobs [colours], count, spacing, center, speed, grain}: radial grid stage + grainy gradient corner blobs |
| beat reveal (`reveal:` on a clip) | shapes `circle` `square` `squircle` `diamond` `star` `hexagon` `triangle` `heart` × patterns `row` `ring` `grid` `scatter` `one`: black on the music's gap, burst on the downbeat, full picture by beat 3 (`./vtk audio` gives the downbeats and silences; showcase `examples/beat_reveal.yaml`) |
| transitions | `cut` · `crossfade` · `dip` · `slide`/`push`/`whip` {dir: left\|right\|up\|down} · `zoom` {pos: auto\|[x, y]} · `blur` · `wipe` {dir} · `circle` {pos} · `glitch` · `flash` {color} · `flood` {from, to, shape: circle\|squircle\|rect, color, hold} (a shape grows out of `from` (a [x, y, w, h] button or a point) past every corner, holds its solid colour a beat, contracts into `to` over the next shot: land it as `to: [x, y, w, h]` on a dark element of the next shot, e.g. a `wordmark-squeeze` pill, and the joint disappears; default 0.75 s) · `shrink` {pos} (the outgoing picture collapses into a point with zoom-blur streaks) · `grow` {pos} (the incoming picture grows out of a point); `sfx: auto\|none\|<sound>` (auto: whoosh/swish at the midpoint); `carry: true` moves each section's text + overlays with its own picture (default for shrink / grow / flood; otherwise texts stay put and both sections' texts show during the overlap, so kinetic text chains use cuts + text exits) |
| animation presets (`anim.in/out`, `text_anim.effect`) | `fade` `rise` `drop` `slide_left/right/up/down` `pop` `pop_small` `zoom` `zoom_out` `blur` `stamp` `spin` `flip` `swing` `bounce` `wipe` `mask` (rises out of its line) `type` `glitch` `none` · kinetic (pair with `motion_blur`): `mega` (slams down from ~6x), `grow` (out of a point; as an exit: shrinks into it), `whip_left/right/up/down` (fast pass-through: enters travelling that way and exits continuing the same way) |
| easings | `linear` `in` `out` `in_out` `quint` `expo` `in_out_expo` `back` `elastic` `bounce` `spring` `spring_soft` `spring_bouncy` |
| idle loops (`anim.idle`) | `float` `wiggle` `pulse` `breathe` `spin` `shake` |
| marks | `circle` (hand-drawn) `underline` `highlight` `strike` `box` `brackets` (scan corners) `arrow` `check` `cross` `ping` `dot` `scribble` `spotlight` (dims the rest) — keys: rect/pos, src/at, draw, dur, color, width, hand, pad, radius, glow, label, label_side, side, length, from, clip (marker / underline / strike stay inside a zoomed card or screen by default; `clip: false` lets them out) |
| sizes | `--aspect 1:1\|4:5\|16:9` or `--sizes`: brand `aspects:` switch the phone to the whole-phone style and move named positions (16:9: phone right, text left). Use named positions (`caption_band`, `upper_third`, `caption_2026`...) for specs meant for several sizes |

**Remotion motion looks** (`motion:` clips/overlays, `./vtk looks --motion`): React components in `motion/src/looks`,
rendered at the output size with the brand/theme colours and fonts (`theme`, `font` props), cached by props.
Text: `text-burst`, `text-assemble`, `text-trail`, `text-italic`, `text-typewriter`, `text-stack`, `text-marker`,
`text-strike`, `text-split` (a word splits open and a second word slides in on a glowing pill); numbers: `stat-counter`, `timer`, `stat-orbit`, `bar-chart`, `line-chart`; story: `chat-bubbles`,
`voice-note`, `notification-stack`, `checklist-grid`, `comment-reply`, `calendar-week`, `card-wall` (endless columns of
cards or your own screenshots, zoom-out "at scale"), `week-ticker` (M T W T F S S lighting up); brand: `logo-stamp`, `wordmark-squeeze` (the name squeezes into its own full stop like an accordion,
the dot grows into a pill with a label; `mode: both` springs it all back so the last frame is the first, `return` starts on
the pill: a loop-ready opener / end card; showcase with `flood`, `pointer` and `liquid_glass`: `examples/prompt_motion.yaml`), `brand-stamp` (a rubber-stamp seal: ring text + broken inner ring + logo or text in the
middle, worn ink; zooms down out of the camera and slams onto the last frame, a director's-signature sign-off to reuse
in every video), `finger-count` ("put a finger down": a drawn gradient hand, or your own photos per count via `images`
(cut-out stickers, aligned), that loses a finger on each `down` cue with a dissolve and a soft press; `path` keyframes
glide it), `end-card`, `progress-bar`, `emoji-burst`, `arc-rings` (rainbow half-rings drawing on behind big type); diagrams: `flow-path`, `hub-beams`, `flow-graph` (a workflow canvas, n8n style, on a dot grid that moves with the camera: nodes with an icon, title, mono tag, body lines with `code` chips, chains of sub-step chips and a `media` panel (waveform, typed code / YAML, frame timeline with a real frame counter, parallel lanes, image strip, motion preview) light up at their `at` while a glowing pulse runs down each bezier / elbow wire; `kind: hub` (an orchestrator with a turning glow rim) and `kind: gate` (a human approval step: amber, dashed and "waiting…" until it approves); edges take `again` (extra pulses, e.g. one tracing the whole path at the end) and `dashed`; camera keys `{at, dur, x, y, zoom}` follow the flow and pull back to the whole map; `show: 0` = on screen from frame 0; `hero: {at, dur, scale, nodes, edges, to}` = a simple big version of the flow as a moving cover (cards lit from frame 0, pulses running), then at `hero.at` each hero card flies to and becomes its node(s) in the full graph (`to: {card: [node ids]}`; several ids = the card splits open) while the rest pops in around them; give the clip `transparent: false` when the graph fills the frame (a small H.264 layer instead of GBs of ProRes alpha)), `team-chart` (a playful org chart of a team of people, tools or agents with job titles: the title is on screen from frame 0, the person at the top (`root: {name, role, photo}`) pops in with a ring drawing round the photo, then each department (`groups: [{label, note, columns, rows: [3, 3, 4], at, members: [{name, role, desc, logo, fill}]}]`) builds in turn: a header chip on the trunk, elbow wires drawing out, members popping in; `style: tree` (default) = small round logos, the role above a bold name and an optional `desc` line, rows hanging off a centre trunk that runs on under each row's middle member (names line up per row); `style: cards` = a box per member with a logo tile and the role on an accent pill; once built, pulses keep flowing from the person to every member, each lighting up as one arrives (`pulseEvery: 0` = none, for a clean still); optional `footer` line last (`footerAt`: on a music downbeat); `spotlight: {at, dur, zoom, badge, badgeAt}` = the camera pushes in on the person (the rest dims, rings pulse, an emoji sticker pops on its word) and back out, e.g. on a voice-over line about them; laid out 1080 wide and scaled to fit, 4:5 fits best; `transparent: false`), `node-map` (a node graph of people and their records: each person's avatar
branches into record nodes that light up with a check and a pulse at their `at` times, step dots fill one by one, more
people join below and the camera eases from one person to everyone; give it a region `x, y, w, h`, e.g. beside a phone; `layout: tree` = the avatar on top, the nodes as text cards in a `columns` grid under it, `wide: true` nodes (e.g. an urgent record) full width below, `sub: true` nodes in a grid under the wide node joined by a line (its sections), and at `compactAt` the tree shrinks to smaller text cards (`compactCols`) while the other people pop in beside it, `perRow` per row: a whole group in one frame; `valign: top` pins it under the captions); backgrounds: `bg-mesh`, `bg-space`,
`bg-rays`, `bg-grid`, `bg-liquid`, `bg-paper` (the catalog in `motion/catalog.json` is the source of truth).
Kinetic stat explainers (fast moves with motion blur; template `stat-explainer`, showcase `examples/kinetic_stats.yaml`):
`text-swap` (a phrase changes word by word: shared words glide, new ones whip in, emoji / `[[img:name]]` props grow out of
a point), `crowd-fill` (faces / photos flood the frame; generic avatars by default), `line-draw` (an outline draws itself
from an SVG file / paths / 10 built-in shapes, then dots or phone icons pop in inside it), `stat-split` (panels grow to
their shares while the numbers count, split apart to exit), `image-rain` (images / emoji / banknotes / confetti: rain,
a stream from a point like a money gun, a fountain; `preroll` starts it mid-flight, e.g. a burst already in the air on the cover frame), `photo-cycle` (a photo card grows from a point with selection
handles, photos + captions swap, shrinks away), `float-cards` (product cards fly in from the edges and drift around a
clear centre), `sticker-tiles` (accent tiles with a word slide in around the edges), `door-reveal` (a 3D door opens and
the camera flies through; the doorway is transparent, so the next scene shows through), `logo-reveal` (a dot grows into
the logo, the wordmark wipes in).
Generic chat/notification looks are for skits — never present them as a real product's UI.
Look props: see `./vtk looks --motion` / `motion/README.md`; every look also takes `delay`, `stage` (`plain` with
`transparent: false` = only the flat theme bg: render a long look as a small opaque H.264 panel and place it as a card
PiP with `shadow: false` instead of a multi-GB ProRes alpha layer), `outro` (exit seconds,
0 = hold), `x`/`y` (frame fractions). Default copy is neutral demo text ("Your App", "Get the app"):
always pass the brief's own text, and never claim "free" / ratings unless true. The brand `logo.png` is passed
to looks with a `logo` prop automatically. Overlays render as ProRes 4444 with alpha (~25 MB/s, cached in
`.cache/motion/`, `./vtk motion --clear`), backgrounds as H.264. The first render downloads Chrome Headless
Shell (~2.5 min, once). Studio preview of every look: `cd motion && npm run studio`.

### Layouts and camera

| layout | what | camera semantics |
|---|---|---|
| `iphone` | drawn iPhone around the recording; model from resolution (corner radius, Dynamic Island). `style: rise` (phone rises from the bottom, `width` 84%, `top` 22.5%), `full` (whole phone, `height`, `center_y`), `screen` (rounded screen, no bezel). `finish`: black / natural / white / desert / blue / silver / orange. `island: auto` covers the recorded pill + red dot | `zoom` scales the phone around `focus` (source px); `pan` moves it (design px). Keep the phone's top below the caption band: zoom around a point near the top (`focus: [660, 300]`); to reveal the bottom of the screen, zoom out slightly (`zoom: 0.93, focus: [660, 0]`) rather than panning up under the text |
| `android` | drawn Pixel-style Android phone around the recording: even black bezel, rounder screen corners, power + volume on the right, a punch-hole camera (`camera: auto` draws it over the hole an emulator renders into its recordings, else a default one; `on` / `off`). Same keys and styles as `iphone` (`style: full`, `height`, `center_y`, `finish`, `shadow`), the brand's `layouts.iphone` defaults apply (`layouts.android` overrides); PiP overlays take `layout: {type: android}` too. Android emulator takes: record with the emulator's own recorder (`adb emu screenrecord start --fps 30 --bit-rate 12M f.webm`): an in-guest `screenrecord` slows a busy emulator's animations to ~5 fps | as `iphone` |
| `card` | rounded content window `x, y, w, h, radius` on a blurred background; `status_cut` hides the status bar | `focus` = centre of the visible source window (source px); `zoom` crops tighter |
| `fullbleed` | covers the frame | zoom/focus/pan crop the source |
| `fit` | whole source visible (letterboxed) on the background, optional `radius` | zoom scales the source |
| `plate` | the recording inside **filmed** footage of a hand holding a phone with a chroma-key screen (`plate:` source name: a still image (rock steady, best: AI hand motion looks fake) or a video; `key: green\|blue`, `zoom`, `push: [1.0, 1.04]` slow push-in across the whole run of plate clips (only with `zoom` ≥ 1.15: at 1.0 the plate barely covers the frame, the push drifts the phone and UI text shimmers), `plate_in`, `plate_speed`, `screen_dim`, `inset`, `island: auto` erases the recorded pill + red dot). The screen is tracked per frame (cached), the recording is warped in with perspective, fingers over the screen stay in front; plates loop (make them start and end on the same frame). Taps, marks and lifts map through the warp | `zoom` crops the plate around the screen. Keep text above the phone (the plate decides where it is) |

### Brands

`workspace/brand/<name>/brand.yaml` (your brand; the engine's `brand/default/` is the base) extends `default` and may set: `colors` (named, used anywhere a colour is
accepted), `fonts` (named `{family, weight}`), `text_styles` (font, size, weight, color, accent, case,
line_height, letter_spacing, max_width, align, shadow {blur, opacity, dy, color}, stroke {width, color},
box {color, opacity, pad, radius, mode: block|line}, highlight {color, box}), `caption_styles`,
`positions`, `layouts`, `background`, `text_anim`, `sfx`, `music`, `vocabulary`, `caption_replace`,
`output.loudness`. Inline styles in a spec may `extends:` a named style and override fields.

**Your brand's notes** live next to its brand.yaml in `workspace/brand/<name>/` (e.g. `MARKETING.md`: creative mindset,
hook bank, hard lines; a product brief; a map of the app's screens). `workspace/CLAUDE.md` says which to read before
grooming or planning. The templates end on `<brand>/endcard.png` (an App Store style card for the app, 1080x1920).
Thumbnail: frame 1 is the default TikTok cover, so the hook is full size from frame 1 (no pop) and sits
inside the centre 3:4 crop used by profile grids; `--frames 0` exports it as a cover PNG.

## Checking your own work

- Every render prints a contact sheet path (`.work/<project>/contact_*.jpg`, frames every 0.5 s) — Read it.
- `--frames 3.1 13.8 20.5` renders stills in seconds for camera/text checks; `--safezones` overlays UI zones.
- Warnings (safe zones, clamped sfx, section fitting) are printed after each render; fix or explain them. Every render also
  scans for **one-frame pops** (a frame unlike both neighbours: a wrong layer, a text frame out of order) and lists their times.
- `--stems` writes the VO and ducked-music stems to `.work/<project>/stems/` for level checks.
- `examples/demo.yaml` renders with no footage: `./vtk render examples/demo.yaml --preview` checks a fresh setup.
  Keep your own regression specs (with your footage) in `workspace/examples/`.

## Engine map (toolkit/)

| file | role |
|---|---|
| `cli.py` | `./vtk` commands |
| `spec.py` | YAML load, schema (`KEYS`), validation with field paths and suggestions |
| `timeline.py` | spec -> frame-exact plan: segments (source time per output frame), sections, overlays, sfx |
| `compositor.py` | per-frame layouts, camera incl. 3D tilt (perspective warp), transitions, text (block / word / letter animation, glass, accent marks), overlays (text, image, counter, mark, video PiP, motion), behind-subject compositing, marks, lifts, taps, captions, look/grade, x264 encode |
| `montage.py` | `montage:` sections -> beat-snapped clips (intro boxes, cached 2x2 grid frames, speed-up, flash) |
| `subject.py`, `native/subject_mask.swift` | `behind: subject\|person`: Apple Vision foreground / person masks, on-device; the Swift helper is built on first use into `.cache/bin/` and kept warm (~35 ms a frame), masks feathered + smoothed over time |
| `anim.py` | easings (incl. springs), entrance/exit/idle presets, layer transforms |
| `shapes.py` | drawn-on marks (hand circles, arrows, highlighter, brackets, spotlight...) |
| `backgrounds.py` | animated backgrounds (mesh, glow, paper, grid, dots, rays, aurora, noise, spotlight) |
| `motion.py` | Remotion bridge: brand/theme props, cached renders, attaches layers to the plan |
| `gallery.py` | `./vtk looks --render` gallery sheets |
| `device.py` | iPhone model table + SDF-drawn device (bezel, band, buttons, island); Android (Pixel-style) body + punch-hole |
| `text.py` | font index (brand + system, static/variable), rich text layout + renderer (emoji, inline images, strike/marker/underline, gradient, glow, accent font), animatable parts |
| `audio.py` | VO processing (pauses, speed), music (file/generated), ducking, sfx, clip audio, LUFS |
| `synth.py` | synthesized SFX and music bed |
| `captions.py` | transcript -> caption chunks / phrases |
| `screenplate.py` | phone plates: chroma-key screen tracking (4 corners per frame, smoothed, cached in `.cache/screens/`), key mask, despill |
| `media.py` | ffprobe, CFR proxies (VFR screen recordings -> 60 fps), frame reader, audio decode |
| `render.py` | render pipeline: motion layers, parallel chunk encoding + concat, audio mux, `.srt`, variants/sizes |
| `brand.py`, `safezones.py`, `contactsheet.py`, `fonts.py`, `analysis/*` | as named (`brand.py` also merges themes) |
| `paths.py` | folders: engine `brand/`, your `workspace/` (brands, history, ideas; `VTK_WORKSPACE` moves it), `inbox/`, caches |
| `elevenlabs.py` | `./vtk eleven`: ElevenLabs REST (voice-over takes, music from a prompt or a timed composition plan, sound effects, voices, credits); key from the Keychain |
| `kb.py`, `channel.py`, `ideas.py` | the brain (learn, duplicate check, validate, commit, SOURCES.md, search, page budgets, cache slimming); channel studies (listing, eras, captions -> narration numbers, thumbnail frame sheets, picks); ideas backlog |
| `motion/` (Node) | Remotion project: `src/looks/*.tsx`, `render.mjs` (`--jobs`, `--still`, `--list`), `catalog.json` |

## Extending the engine

Keep brand-specific names, copy and assets out of engine files: they belong in `workspace/`.
When a brief needs something the spec can't express: add it **generally** (a new clip/overlay/layout
option or command), add the key to `spec.KEYS` + validation, document it here (spec reference + table),
add or extend an example spec, render a test, commit. No one-off hacks inside a project spec, no
per-project code. New motion graphics that don't touch the recording: add a Remotion look in
`motion/src/looks/` (register it, update `catalog.json`) and use it with `motion:`. Effects that move or
annotate the real recording belong in the compositor (it knows where every source pixel lands).
Known gaps: reverse playback, clip audio on speed ramps, HDR tone mapping (needs an ffmpeg with zimg),
text-region detection in `reference` is a heuristic, transitions between two different aspect layouts are
not blended specially.

## Daily prompt (for the user)

> New video. Files are in inbox/. Brief: <what it's for, the story, on-screen text, length, output name>.
> [VO: vo.mp3 in inbox — time the cuts to it.] [Reference: ref.mp4 — match its pacing, not its content.]
> Analyse, show me the edit plan, then render it into inbox/.
