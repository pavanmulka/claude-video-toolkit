# To build: tool gaps seen in the wild

Part of the brain (start at `trends/BRAIN.md`). One lesson per line: the lesson, *why*, the tool to use, proof
`[views: source id]` (`./vtk kb show <id>`). Max 80 lines: merge or retire to `trends/archive.md` before adding.

- Text behind a *person* (needs subject cut-out). Real 3D objects (Remotion + Three.js).
- Speaker-coloured captions (a second voice in yellow under a "mom:" label); an outlined border on text boxes (tally pill).
- Hook script check in `./vtk validate`: flag a VO hook with no contrast pivot (but/however/yet), a long first sentence,
  topic words after the first sentence, I/me/we framing, a reading grade above 5th, or no foreshadow line in the first 3 s.
- Competitor watch list ranked by outlier score (views ÷ channel median, last 3 months, engagement ≥ 2%) → topic buckets;
  a `bucket` field on ideas with a per-bucket views report (the 2-week kill rule). [1ilmgc]
- Split-screen compare layout (two clips stacked with labels: raw vs edited, old way vs new) · text / marks tracked to a
  moving object (Vision tracking) · 2.5D parallax on AI stills (depth map) · per-letter 3D spin in type. [fb 1922283]
- Match-cut helper: find the best joint between two clips by texture/colour/motion similarity (frame pairs ranked) and
  export the last frame of A as Flow's first-frame reference in one command. [fb 2130876]
- Built-in outlines for `line-draw` (countries / states from public-domain Natural Earth, simplified) and a small library
  of 3D-looking prop renders (a money bag, a banknote gun, a door) as alpha stills; today they come from the user's SVG /
  PNG files. [screenrecording-10-08]
- Carousel (stills per section are built: `output.carousel`): one wide canvas sliced into N slides so people, icons and
  lines cross the seams (panorama, follow-the-line); `frames: N` slides sampled from one section over time (flipbook,
  swipe-to-zoom, depixelate reveal); a 4:5 MP4 slide for a moving panorama. [meta-slide-engaging; demb4r]
- `snap: downbeat` for sections: pull each section edge onto the nearest bar start from `./vtk audio` (today the
  durations are worked out by hand from the downbeat list; the shape reveal itself is built: `reveal:`). [fb 2492939]
- `learn` for Instagram photo carousels: yt-dlp stops on "No video formats". Fix found: `yt-dlp -J
  --ignore-no-formats-error` lists every slide (image slides carry a 1080 square-cropped thumbnail URL, video slides real
  formats + the caption, likes, comments): download them into a slide sheet + OCR text. The thumbnail without a size in
  its `stp=` is the full uncropped 4:5 slide. [decfon; demb4r; dd3bqb]
- Kinetic VO text with a size hierarchy: captions that stack in the top third and size each word by weight (stopwords
  small, nouns / the accent word big) with per-word colour, timed from the transcript (today: hand-built overlays). [fb 2547005]
- Isolation + reading-order marks: a `spotlight` option that greys out (desaturates) everything outside the rect instead
  of only dimming it, and a `path` mark: numbered dots joined by a drawn line to show what the eye reads first (1 → 2). [dechlq]
- From the Claude-made launch films: a one-element UI morph look (a pill that becomes loader → tick → player → slider →
  toast, content swapping with its own mask; generic states only, never a product's screens), an iris-blade transition
  (6 blades close and snap open onto the next shot), and a 3D fly-over of a long screenshot (the page lies on a studio
  floor, the camera glides down it, cards lift off). [pm launch-film; pm morph-ui]
