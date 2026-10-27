# Motion & sound

Part of the brain (start at `trends/BRAIN.md`). One lesson per line: the lesson, *why*, the tool to use, proof
`[views: source id]` (`./vtk kb show <id>`). Max 80 lines: merge or retire to `trends/archive.md` before adding.

- Baseline rules live in CLAUDE.md (standing editing rules, "What works now"): hard cuts, 2–3 whips at section changes,
  one flash on the reveal, one phone move, marks / lifts on proof only; effects on 3–5 beats, original audio only. [baseline]
- **Let the sound make the promise, the picture break it**: the audio sets the expectation (a jet roar getting louder
  and brighter, a ringtone, hold music) and the twist lands on its peak. Trends often live in the sound: both fake-out
  versions used the same flyover recording. Read every reference's sound map. [dcy8bl]
- **One sound per job, so the ear learns the code**: attention → a record scratch / meme yell; statement → deep boom;
  comedy → the "vine boom" thud after the punchline; unexpected reveal → a dark two-stab sting; suspense / tension → a
  (metallic) riser cut dead into the next word; hype right before the payoff → a bass impact; pop-up → pop + click;
  smooth transition → a camera flash on a white flash cut (or whoosh); quiz / myth-vs-fact → "correct" ding vs "wrong"
  buzzer; money → "ka-ching". *The sound tells viewers what kind of moment this is before the picture does.* Tools:
  `scratch`, `boom`, `reveal`, `riser` / `riser_metal`, `impact`, `pop` + `click`, `flash`, `correct` / `wrong`, `cash`
  (CLAUDE.md "Sound job map"). Never rip a creator's pack, a meme or a game sound: rebuild it.
  [595K: fb 28599726; 82K: fb 1379355]
- **A cut with no sound feels like a mistake** in fast talking-head / jump-cut edits: each cut gets a quiet sound
  (-24 to -30 dB). App demos keep the 3–5 loud beats; the rest stays quiet. [595K: fb 28599726]
- **Pick the music by the video's job; it sets the mood before a word is said**: storytelling → quiet, almost no bass,
  minor, slow pads/piano that let the voice lead · teaching → a steady head-nod beat (~90 BPM), sparse, under the voice ·
  day in the life → laid-back groove, heavy bass, warm/major · emotional → slow solo piano, minor · energetic → dense
  trap drums, 808, bright and loud. *Wrong mood = the viewer feels it's off before they know why.* Business accounts: get
  the vibe from the commercial library or `music: {generate: {mood: story|teach|vlog|emotional|energetic}}`, never the
  chart songs creators name. [37K views, 2K reactions: fb 1445211]
- **The 2026 motion-graphics stage**: a light polar grid with grainy gradient blobs in the corners, rainbow arcs rising
  behind big type, an endless card wall zooming out for "at scale", a day ticker for "every single day", counters for
  numbers; each graphic carries one idea, cut every ~2 s. Tools: background `polar`, looks `arc-rings`, `card-wall`,
  `week-ticker`, `stat-counter`. [fb 1922283]
- **Sound hides the joint**: the song keeps playing straight through a match transition while an air/wind rush swells
  into the hidden cut and the drone's roar carries the new world (sound map: broadband rise at the joint, one hit on the
  reveal). Never a pause or a beat drop at the joint: continuity in the sound sells the continuity of the shot. [4.7M: fb 2130876]
- **Motion blur sells speed**: every fast move (a word whipping in, a number slamming down from giant, a scene collapsing
  into a point) smears along its path for 2–4 frames and is razor sharp the moment it stops. *Without blur, fast moves
  stutter and look cheap; with it they read as studio work.* In fast (0.25–0.35 s, expo), short hold, out the same way
  (pass-through). Tools: `defaults: {motion_blur: 1}` (theme `kinetic_light`), presets `mega` / `grow` / `whip_*`,
  transitions `shrink` / `grow` (texts travel with their picture). [screenrecording-10-08; pm morph-ui]
- **The picture breathes with the song's bar** (beat-synced edit): one shot per bar (4 beats, ~1.95 s at 123 BPM), and
  inside the bar something moves on every beat (a shape hops, multiplies, morphs); the full picture lands by beat 3–4.
  Where the song stops dead (stomp… gap), the picture goes black with one small shape waiting in the dark, and on the
  next hit the shape bursts (multiplies with motion blur). *Silence = black, hit = picture: the eye hears the edit, so
  the song seems written for the cuts.* Map the song first (`./vtk audio`: downbeats + silences), then cut sections on
  downbeats (`beats: 4`, `montage:`), put the black on the gaps with a clip `reveal:` (shapes burst on the hit) and
  land the text with it (`text_anim.delay`); pick songs with a dropout before each bar.
  [264K: fb 2492939]
- **Beat edit montage** (CapCut template style): a split-word title ("LI [AUGUST] FE"), then many short clips cut on
  every beat: the first ones grow from small boxes, a grid collage builds tile by tile, the cuts double in speed through
  the build-up, a white flash on the drop. Colour-ordered clips read as one sweep. Variation: each shot is revealed
  through shape masks (circles, diamonds, a star, hexagons, an X) that burst on the bar's hit and merge into the full
  frame. Tools: `montage:` + `text-split`. [264K: fb 2492939; 78K: fb 1098626]
- **Scale-illusion transition (texture match)**: a close-up texture becomes a landscape in what looks like one camera
  move (a hand sprinkles crumbs on a wooden table, the camera dives in, the wood grain is a harvested field and the crumbs
  are hay bales, an FPV drone races to the horizon). *No story, no words needed: viewers rewatch to find the cut, and the
  reveal of scale is the payoff.* A series label ("Day 156 making random transitions…") turns it into a habit. Tool: two
  shots + `zoom` transition at peak speed + an air-rush sound. [4.7M (9.2M on the page): fb 2130876]
- **Morph, don't cut: every scene is made out of the last one** (one continuous take): a button becomes a loader, a
  tick, a card; a shape floods the frame (past every corner, ~0.3 s or half the screen changes in one frame), holds its
  colour a beat and contracts into the next scene, landing on a dark element of the next shot so the joint disappears;
  the last frame is the first. Text that swaps inside a morphing shape gets its own mask and timing. *The eye follows
  one object and never re-orients; it reads as studio work, not a template.* Tools: transition `flood` (`to: [x, y, w,
  h]`), `grow` / `shrink`, look `wordmark-squeeze` (`mode: return` after a flood), `output.loop`. [pm launch-film; pm morph-ui]
- **A finger or cursor drives every change**: a real press, drag or long-press causes each new state while the camera
  zooms onto it; the pointer enters already moving, leans into its move, dips on the press, and a drag follows it.
  *Cause → effect makes the UI feel touchable and the eye follows the pointer instead of hunting.* Tools: clip
  `pointer: touch|cursor`, taps `hold:` / `drag:`, `autozoom`. [pm launch-film; pm morph-ui]
- **Studio motion is mostly what you leave out**: springs with a tiny overshoot at most, no hold over 1 s, every shot
  enters already moving and leaves accelerating. Banned in every brief: crossfades, blur-ins, particle bursts,
  shockwave rings, glows, RGB split, camera shake, lens flares, bouncy easing, grid floors. *Each of these is what
  makes a video read as a template.* [pm launch-film; pm morph-ui]
- **Liquid glass reads as "now"** (iOS 26): labels and toolbars as clear glass that bends the picture at its rim with
  faint colour fringes and a rim light, over photos or footage; frosted blur reads older. Tool: text style
  `liquid_glass` (`box.mode: liquid`). [pm launch-film]
- **Check on the beat grid before the full render**: show a beat map and 3–4 stills first, render one frame per beat,
  then scan the final for one-frame pops (a frame unlike both neighbours). Tools: `./vtk audio`, `--frames`, the
  render's pop scan (warnings). [pm launch-film; pm morph-ui]
