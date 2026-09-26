# motion/ — Remotion motion-graphics looks

Code-drawn animated "looks" (kinetic text, counters, UI stories, charts, backgrounds) that the Python
engine renders as video layers and stacks into an edit. Remotion v4 (4.0.527) + React 19 + zod 4.

```bash
cd motion
npm install                      # once (the first render also downloads Chrome Headless Shell, ~100 MB)
node render.mjs --list           # catalog JSON (no bundling)
node render.mjs --jobs jobs.json # render layers (the Python bridge uses this)
npm run studio                   # interactive preview of every look (optional)
```

## CLI contract (`render.mjs`)

| command | does |
|---|---|
| `node render.mjs --jobs <jobs.json>` | renders `[{"id", "props", "out"}]` in one browser session; one JSON line per finished job on **stdout** |
| `node render.mjs --still --id <id> --props <props.json or JSON> --frame <n\|mid\|last> --out <file.png>` | one PNG (with alpha when the look is transparent) |
| `node render.mjs --list` | prints `catalog.json` (no bundling) |
| `node render.mjs --sync-fonts` | copies `../brand/fonts` into `public/fonts` + writes `public/fonts/manifest.json` (automatic on every render) |
| `node render.mjs --catalog` | regenerates `catalog.json` from the zod schemas (automatic when `src/` changes) |

Options: `--concurrency N` (default: half the CPU cores), `--gl angle|swangle|…` (default `angle` on macOS), `--verbose`.
Paths in jobs/flags may be absolute or relative to the caller's cwd.

**Job output line** (stdout, one per job, in order):
`{"id","out","frames","seconds","fps","width","height","alpha","codec","render_seconds"}` —
`seconds` = length of the rendered media (frames / fps), `render_seconds` = wall time.
A job whose `out` ends in `.png` renders a still instead (`frame`: number, `"mid"` (default) or `"last"`).
Logs/progress go to **stderr**. On any failure the process stops, prints `render.mjs error: …` as the last stderr
line (job id, output path, reason such as `Invalid props for "stat-counter": to: expected number`) and exits **1**.

**Encoding**

| layer | output |
|---|---|
| transparent (`props.transparent` true; overlays default to true) | **ProRes 4444 + alpha** in `.mov` (`yuva444p10le` in, ffprobe reports `yuva444p12le`), PNG frames, straight (un-premultiplied) alpha |
| opaque (backgrounds, or `transparent: false`) | **H.264 CRF 14**, yuv420p, BT.709, in `.mov`/`.mp4`; add `"codec": "prores"` to a job for ProRes 422 HQ |
| `.webm` + transparent | VP9 with alpha (optional) |

Backgrounds (`kind: background`) always render opaque and ignore `transparent`.

**Caching**: `src/` + `package*.json` are hashed; the webpack bundle lives in `.bundle-cache/<hash>/` and is reused
until the code changes (first bundle ~4 s, then 0 s). `public/` is symlinked into the bundle, so fonts/assets
copied later are visible without re-bundling. Safe to delete `.bundle-cache/`.

**Assets**: any prop string that is an **absolute path to an existing file** (logo, avatar, icon image) is copied to
`public/_assets/<sha1>.<ext>` and rewritten to that relative path; components load non-URL paths with
`staticFile()`. Paths inside `public/` and `http(s)://` / `data:` URLs also work.

## Props every look accepts

| prop | default | notes |
|---|---|---|
| `width`, `height`, `fps` | 1080, 1920, 30 | 1920x1080 and 1080x1080 are laid out properly too |
| `duration` | per look | seconds; `durationInFrames = round(duration * fps)` |
| `transparent` | true (overlays) | false paints a themed stage (theme `bg` + `glow` radial light) |
| `theme` | `{bg:#0E0416, fg:#FFFFFF, accent:#61F0EA, accent2:#B28CFF, muted:#9A8FB0, glow:#7C5CFF}` | partial objects are merged with the defaults |
| `font` | `{family:"TikTok Sans", weight:800, stretch:100}` (some looks: 900 / condensed) | `stretch` = width axis % (TikTok Sans 75–150) |
| `font2` | `{family:"Instrument Serif", weight:400, style:"italic"}` | secondary/editorial font; falls back to Didot / Georgia |
| `delay` | 0 | seconds of empty layer before the animation starts |
| `outro` | 0.35 (0 for bars, bursts, end card, backgrounds) | exit (fade + blur + drift) at the end; 0 = hold the last pose |

Sizes in props are **design units**: 1 unit = min(width, height) / 1080 px. Positions `x`/`y` are fractions of the frame.
Text props use the same markup as the Python specs: `**accent**` (accent colour), `*italic*` (font2), `\n` (line break).
Numbers: `decimals: -1` (default) = as many decimals as the target value (`118` → `113%` mid-count, `4.5` → `3.2`).

## Fonts

`render.mjs` scans `../brand/fonts/**` (and `VTK_FONT_DIRS`), reads family/weight/italic/variable axes from the
font files, copies them into `public/fonts/` (variable fonts preferred; git-ignored) and writes a manifest.
`loadBrandFont(family, weight, style)` (src/lib/fonts.ts) registers the best face with `@remotion/fonts` and every
look waits (`delayRender`) until its fonts are loaded. Families not in the manifest are used as installed system
fonts (e.g. `"Georgia"`). Emoji render with Apple Color Emoji. New OFL families dropped into `brand/fonts/<Family>/`
are picked up on the next render — no code change.

## Looks

`*` render fps = frames per second of wall time for a 1.5 s 1080x1920 test render on an Apple M4 (5 tabs), incl. ProRes encode.

<!-- looks:start -->
| id | kind | default dur | render fps* | what it looks like | look props (defaults) |
|---|---|---|---|---|---|
| `text-burst` | overlay | 2.5s | 16.1 | 1-3 big words punch in at the centre (scale-slam with zoom ghosts), radial speed lines, shockwave ring, soft glow and sparkles; accent words in the accent colour. | `text`="IT'S **HERE.**", `size`=210, `maxWidth`=0.86, `upper`=true, `stagger`=0.14, `lines`=true, `rays`=34, `glow`=0.8, `shake`=0.6, `sparkles`=true, `x`=0.5, `y`=0.5 |
| `text-assemble` | overlay | 3s | 17.8 | Letters fly in from scattered positions, rotations and scales (with blur) and spring into a clean line; accent words coloured; a light shimmer sweeps across once assembled. | `text`="Built for **travelers.**", `size`=132, `maxWidth`=0.86, `upper`=false, `stagger`=0.035, `spread`=560, `spin`=150, `order`="random", `shimmer`=true, `glow`=0.6, `x`=0.5, `y`=0.5 |
| `text-trail` | overlay | 3s | 22.8 | Words appear one at a time, each revealed by a bright spark sweeping across it with a comet trail and shed particles; revealed words flash with a soft glow. | `text`="Every **flight.** Every **…", `size`=104, `maxWidth`=0.86, `upper`=false, `wordDuration`=0.3, `gap`=0.06, `trail`=260, `glow`=0.7, `x`=0.5, `y`=0.5 |
| `text-italic` | overlay | 3s | 17.4 | Editorial line: sans words rise in with blur, the *italic* serif accent word (font2, Instrument Serif) lands larger in the accent colour and a hand-drawn underline draws itself beneath it. | `text`="Plan less.\n*Travel more.*", `size`=112, `emScale`=1.22, `maxWidth`=0.86, `stagger`=0.09, `underline`=true, `glow`=0.5, `x`=0.5, `y`=0.5 |
| `text-typewriter` | overlay | 3.5s | 27.1 | Text types itself character by character (natural cadence, pauses at punctuation) in Space Mono with a glowing blinking caret; **accent** words get an accent chip swept behind them after typing. box=field wraps it in a frosted search/prompt field. | `text`="Where's my **boarding pass…", `mono`={…}, `size`=76, `maxWidth`=0.84, `cps`=17, `start`=0.35, `caret`=true, `highlight`=true, `align`="left", `box`="none", `x`=0.5, `y`=0.5 |
| `text-stack` | overlay | 2.8s | 13.5 | 2-5 short heavy condensed lines slam in one after another (scale-slam, blur, flash) with a tiny camera shake on each; the **accent** line lands on an accent chip. justify=true makes a poster stack. | `lines`=[4], `size`=190, `lineHeight`=0.9, `maxWidth`=0.84, `upper`=true, `justify`=false, `stagger`=0.26, `shake`=0.7, `chip`=true, `align`="center", `glow`=0.5, `x`=0.5, `y`=0.5 |
| `text-marker` | overlay | 3s | 24.7 | Words fade up, then a highlighter pen sweeps behind the **accent** words (rough hand-drawn edges, streak texture, slight tilt) and the text under it flips to dark ink for contrast. | `text`="Keep **every detail**\nin …", `size`=100, `maxWidth`=0.86, `upper`=false, `stagger`=0.07, `sweep`=0.5, `marker`="", `opacity`=0.95, `tilt`=-1.1, `x`=0.5, `y`=0.5 |
| `text-strike` | overlay | 3s | 26.3 | Correction beat: shows the `from` word, a glowing line strikes through it, it tips and drops away with gravity, and the accent `to` word springs in with a glow flash and sparkles (e.g. folders -> people). | `prefix`="Plan with", `from`="spreadsheets", `to`="**one app.**", `suffix`="", `size`=170, `prefixSize`=72, `swapAt`=0.95, `strikeColor`="#FF4D6D", `upper`=false, `sparkles`=true, `x`=0.5, `y`=0.5 |
| `stat-counter` | overlay | 3s | 18.4 | Big number counts from `from` to `to` (expo ease, motion blur while fast, bump + glow + light sweep when it lands) with a label below and a giant outline copy drifting behind. Formats: integer, decimal, percent, currency, time (m:ss), compact (12.4K); decimals follow `to` unless set. | `from`=0, `to`=12400, `format`="integer", `decimals`=-1, `prefix`="", `suffix`="", `currency`="$", `separator`=",", `label`="trips **organized**", `countDuration`=1.8, `size`=250, `labelSize`=58, `outline`=true, `glow`=0.7, `x`=0.5, `y`=0.47 |
| `timer` | overlay | 4.5s | 25 | Call-timer style clocks (m:ss in Space Mono) that count up or down with a label and pulsing dot; compare mode shows e.g. "The old way 3:47" vs "With the app 0:12" - bad timers finish red with a shake, good ones finish in accent with a check. | `items`=[2], `mono`={…}, `countDuration`=1.4, `realtime`=false, `stagger`=1.7, `size`=150, `badColor`="#FF5A6E", `vs`=true, `x`=0.5, `y`=0.5 |
| `logo-stamp` | overlay | 3s | 17.7 | Logo stamps down from big (blur, squash-and-stretch, shockwave ring, particles, tiny camera shake), wordmark letters rise in, tagline tracks in; a light sweep crosses logo and wordmark while the logo floats on a breathing glow. | `logo`="", `name`="Your App", `tagline`="Every trip, one place.", `logoSize`=240, `nameSize`=116, `taglineSize`=46, `shape`="app", `layout`="auto", `shine`=true, `ring`=true, `x`=0.5, `y`=0.5 |
| `end-card` | overlay | 4s | 20.6 | End card: logo pops in on a breathing glow, headline words rise in, CTA pill springs up then pulses with a radar ping and a recurring shine sweep; optional star rating + App-Store-style subline. | `logo`="", `name`="Your App", `showName`="none", `headline`="Every trip,\n**one place.**", `cta`="Get the app", `ctaIcon`="arrow", `subline`="On the App Store", `rating`=0, `logoSize`=190, `headlineSize`=96, `ctaSize`=56, `x`=0.5, `y`=0.5 |
| `emoji-burst` | overlay | 2.5s | 13.6 | Physics burst of emojis (Apple Color Emoji) and flipping confetti in theme colours from a point: launch cone, drag, gravity, spin, pop-in and fade; soft flash + ring at the origin. Several bursts via `bursts`. | `emojis`=[5], `count`=30, `confetti`=28, `bursts`=[1], `origin`=[2], `direction`=-90, `spread`=110, `speed`=1700, `gravity`=2600, `size`=78, `life`=2.1, `flash`=true |
| `progress-bar` | overlay | 10s | 27.4 | Thin watch-time bar on the top or bottom edge that fills across the whole duration: accent gradient, glow, shimmer and a glowing head; optional stories-style segments. | `position`="top", `thickness`=10, `inset`=0, `margin`=0, `from`=0, `to`=1, `segments`=0, `gap`=8, `track`=true, `glow`=0.8, `head`=true, `intro`=0.25 |
| `chat-bubbles` | overlay | 6s | 25.1 | Messaging thread: bubbles spring in one by one (mine on the right in the accent colour, theirs on the left with avatar + name), typing dots before their messages, the thread scrolls up as it grows, "Delivered" under my last message. Generic styling from the theme. | `messages`=[4], `header`="", `headerAvatar`="", `typing`=true, `typingDuration`=0.85, `gap`=0.55, `size`=52, `columnWidth`=0.88, `areaHeight`=0.6, `meColor`="", `themColor`="", `delivered`=true, `y`=0.47 |
| `voice-note` | overlay | 5.5s | 25.7 | Voice-note bubble: play button flips to pause, waveform fills in the accent colour as it plays (bars near the playhead dance), elapsed time counts, transcript words light up in sync; then a reply bubble springs in and types itself. | `from`="them", `name`="Alex", `avatar`="", `noteLength`=14, `transcript`="Can you find the hotel’s n…", `reply`="Found it, sending now 👍", `playAt`=0.7, `playDuration`=2.6, `bars`=38, `size`=50, `columnWidth`=0.88, `y`=0.5 |
| `notification-stack` | overlay | 4.5s | 21.6 | Lock-screen style: optional big clock + date, then notification cards (icon, app, time, title, 2-line body) drop in from above on springs; the newest lands on top and pushes older ones down (they collapse into a pile after three). Dark or light glass. | `notifications`=[3], `clock`=true, `time`="8:30", `date`="Tuesday, September 23", `stagger`=0.75, `start`=0.5, `glassTone`="dark", `size`=34, `cardWidth`=0.92, `y`=0.2 |
| `checklist-grid` | overlay | 4.5s | 23.1 | Title words rise in, then numbered frosted-glass cards flip up into a 2x2 (or N) grid one by one; a check mark draws itself on each (ring, fill, tick) with an accent glow; a light sweep crosses the finished grid. | `title`="Everything for **the trip*…", `items`=[4], `columns`=0, `stagger`=0.32, `numbered`=true, `check`=true, `size`=46, `titleSize`=78, `y`=0.5 |
| `comment-reply` | overlay | 3s | 23.3 | "Replying to @username" comment sticker: white card with avatar, reply arrow, @username and the comment text pops in with a bouncy spring and tilt, then gently floats. Generic styling (not a platform imitation). | `username`="weekend.traveler", `text`="How do you keep track of a…", `avatar`="", `label`="Replying to", `cardColor`="#FFFFFF", `inkColor`="#16121C", `size`=44, `maxWidth`=0.8, `tilt`=-2, `x`=0.5, `y`=0.3 |
| `calendar-week` | overlay | 4.5s | 20 | Frosted weekly calendar panel (title, day header with today highlighted, hour grid, red "now" line) where event blocks drop into their day one by one with a bouncy landing. | `title`="September", `subtitle`="Sep 22 – 28", `days`=[7], `startDate`=22, `today`=1, `startHour`=8, `endHour`=18, `now`=11.4, `events`=[6], `stagger`=0.3, `panelWidth`=0.94, `panelHeight`=0.62, `y`=0.5 |
| `flow-path` | overlay | 4s | 25.6 | A glowing gradient wave draws left to right over a faint dashed track with a bright comet head; milestone nodes pop (with a ping) as the line reaches them and their labels rise in, alternating above/below. | `nodes`=[4], `title`="", `amplitude`=120, `waves`=1.25, `drawDuration`=2.4, `start`=0.25, `margin`=0.08, `labelSize`=38, `glow`=0.8, `y`=0.52 |
| `hub-beams` | overlay | 4s | 20 | Source pills (emoji + label) slide in on the left, curved beams draw into a central hub card (logo, rotating gradient border, breathing glow) and bright pulses keep flowing along the beams into it; the hub bumps as pulses arrive. | `items`=[4], `hubLabel`="Your App", `hubLogo`="", `speed`=1, `itemSize`=44, `hubSize`=270, `y`=0.5 |
| `bar-chart` | overlay | 3.5s | 23.6 | Bar chart: title rises in, grid draws, bars grow on staggered springs while their values count up; the highlighted bar glows in the accent gradient with its value on an accent pill. | `data`=[6], `title`="Weekly **active** users", `format`="integer", `decimals`=-1, `prefix`="", `suffix`="", `max`=0, `stagger`=0.08, `growDuration`=0.9, `values`=true, `y`=0.52 |
| `line-chart` | overlay | 3.5s | 24.3 | Line chart: smooth gradient line draws left to right with a glowing head, points pop as it passes, a gradient area fills in behind it, and a value pill + ping lands on the final point. | `data`=[8], `title`="Users **joining** every week", `format`="integer", `decimals`=-1, `prefix`="", `suffix`="", `drawDuration`=1.8, `area`=true, `callout`=true, `labels`=true, `y`=0.52 |
| `stat-orbit` | overlay | 4s | 17.7 | Central stat inside a gradient progress ring that fills while the number counts up; emoji/icon bubbles orbit it on a tilted 3D ellipse (passing in front of and behind the ring); label rises in below. | `value`=87, `from`=0, `format`="percent", `decimals`=-1, `prefix`="", `suffix`="", `label`="of users found **what they…", `progress`=-1, `icons`=[5], `orbitSpeed`=0.07, `countDuration`=1.6, `size`=470, `y`=0.46 |
| `bg-mesh` | background | 8s | 20.9 | Soft pastel mesh gradient: large colour blobs drift slowly on Lissajous paths over a light base, with fine animated grain (no banding). Colours via props. | `colors`=[5], `base`="#F7F2FF", `speed`=1, `blob`=0.55, `grain`=0.06 |
| `bg-space` | background | 8s | 26.8 | Deep navy/black space with a breathing purple "stage" glow at the bottom, a glowing planet-horizon arc, twinkling drifting stars (a few with soft halos), vignette and grain - the premium SaaS launch backdrop. | `base`="#05030C", `glowColor`="", `stars`=170, `arc`=true, `drift`=1, `grain`=0.05 |
| `bg-rays` | background | 8s | 22.2 | Rotating starburst: two counter-rotating soft ray layers (conic gradients) radiating from a glowing centre, faded at the core and edges, with vignette and grain. | `color`="", `base`="", `rays`=16, `speed`=6, `center`=[2], `intensity`=0.35, `grain`=0.05 |
| `bg-grid` | background | 8s | 23.6 | Glowing grid: a 3D perspective floor grid gliding toward the viewer under a bright horizon line (style=perspective), or a drifting dot grid lit by a wandering spotlight (style=dots). | `style`="perspective", `color`="", `base`="", `cell`=64, `speed`=1, `grain`=0.04 |
| `bg-liquid` | background | 8s | 16.1 | Liquid topography: glowing contour lines of a slowly flowing, domain-warped noise field (marching squares on canvas), coloured along a gradient from accent2 to accent. | `colors`=[0], `base`="", `lines`=14, `scale`=1, `speed`=1, `thickness`=2.2, `grain`=0.04 |
| `bg-paper` | background | 8s | 15.4 | Warm paper: procedural mottled paper texture with fibres, a slowly drifting soft light, vignette and animated multiply grain - for editorial looks (pair with dark text / the italic serif). | `paper`="#F2EADF", `grain`=0.12, `fibers`=true, `vignette`=0.3 |
<!-- looks:end -->

## Layout (for maintainers)

```
render.mjs            CLI: fonts sync, asset copy, bundle cache, render jobs/stills
catalog.json          generated from src (scripts/catalog.mjs) - the Python side validates props against it
src/index.ts, Root.tsx  one <Composition> per look (zod schema, defaultProps, calculateMetadata)
src/lib/              schema helpers, fonts, text measuring/fitting, animation + colour helpers, fx (speed lines,
                      shockwave, sparkles, shine, check), UI parts (avatar, glass, bubble tail), grain
src/looks/*.tsx       one file per look (schema + component via defineLook); backgrounds.tsx has the six bg-*
scripts/verify.mjs    strips | stills | clips | catalog  -> ../.work/motion/ (visual QA, render times, contact sheet)
scripts/sheet.mjs     frame strip of one look; scripts/readme-table.mjs refreshes the table above
```

Adding a look: create `src/looks/<id>.tsx` with `defineLook({id, category, kind, description, duration, props, render})`
(props via the helpers in `src/lib/schema.ts`, every field documented), add it to `src/looks/index.ts`, then
`node render.mjs --catalog && node scripts/readme-table.mjs`. Look props must not reuse common prop names.

## Known limitations

- Rendering is CPU/GPU heavy Chrome screenshots: ~10–25 fps at 1080x1920; ProRes 4444 files are large
  (~25–30 MB per second at 1080x1920) - they are intermediates for the Python compositor.
- Frosted glass uses `backdrop-filter`, which only blurs what is inside the same layer (the stage when
  `transparent: false`); over video (alpha layer) cards are translucent, not blurred.
- Text fitting measures in the browser; extremely long strings shrink to fit, they do not paginate.
- System-font fallbacks (Didot, Georgia, Apple Color Emoji) only exist on macOS renders.
- Remotion is free for individuals and companies with up to 3 people; bigger teams need a Remotion company licence.
