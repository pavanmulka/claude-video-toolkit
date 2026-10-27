# Text, captions & fonts

Part of the brain (start at `trends/BRAIN.md`). One lesson per line: the lesson, *why*, the tool to use, proof
`[views: source id]` (`./vtk kb show <id>`). Max 80 lines: merge or retire to `trends/archive.md` before adding.

- **Captions are expected** (about half of US viewers use them often): max 2 lines, 1.5–3 s per block; keep text out of
  the top 10–14% and the bottom 20–35%. `captions: {skip: [hook]}` when the hook text already shows the words.
  [[XR, May 2026](https://www.xr.global/press-releases/captions-are-no-longer-optional-u-s-audiences-now-expect-them-everywhere-they-watch-video)]
- Clean look (`clean` / `reveal`, CLAUDE.md typography): sentence case, soft shadow + thin outline, keyword in the brand
  colour, 1–3 words per chunk (3–5 for tutorials), ~60–65% down; ALL CAPS only for hooks; one emoji max per element. [baseline]
- **Creator-native text**: TikTok Sans SemiBold, lowercase, white with a thick black outline, 1–4 words at the centre
  (≈ our `word_highlight` captions in lowercase); a second speaker in yellow under a small "mom:" label; running counts
  in an outlined pill (": 4", "$1.07"); an emoji checklist that ticks off steps; red arrows on the key object. Her
  2025+ captions got smaller and lighter, like the clean look above. [frame sheets: jennyhoyos]
- **Text in AI video**: keep hooks, captions and labels in the editor (exact fonts, safe zones, A/B-able, no typos); let
  the AI render only text that lives in the scene (a sign, one word on a form, a sticky note), 1–2 words max, and
  never a product's UI. The models can render timed text, but it can't be edited or tested afterwards. [388K: wj8sgb]
- **Depth type, not flat captions**: giant words *behind* the subject (the speaker, a hand holding the phone) and 3D
  block letters (gradient face + solid extrusion + dark outline) read as "edited", not templated; flat white pills on
  every video now look routine. Tools: `behind: subject|person`, style `extrude`. One depth moment per section, the
  keyword still readable around the subject. [3.8K views, 35K on IG: fb 1922283]
- **Flat stage, ink type, one marker colour** (premium B2B explainer): light grey stage, black medium-weight geometric
  sans in sentence case, the key number underlined with a thick marker stroke in one bright accent that also colours the
  props (tiles, a door). *Calm and credible, and every use of the accent points at the claim.* Tools: theme
  `kinetic_light`, styles `stat` (`**54%**` gets the underline), `stat_label`, `plain_title`. Carousels too: one page colour on
  every slide, ink + one accent for the answer words. [screenrecording-10-08; demz4c]
- **Contrast decides where the eye lands, so give it to the one word that matters**: the eye goes to the strongest
  contrast in the frame before the brain reads anything. Put the key word in the colour that fights the background most
  (red on a green set, yellow on blue sky, a bright marker block under black type on a pale page); when no colour
  contrasts, use white; grey or black on mid tones reads "meh". Brightness counts too: on a screen pure yellow reads ~93%
  as bright as white, red ~21%, blue ~7%, so a yellow marker word is read before the face; on a grey stage give colour
  only to the subject (one yellow bus on a grey street). Squint at the frame: the word still visible is the one people
  read first. Tools: accent / `highlight` marker per background, `accent_box`. [186K: fb 2547005; 5.1K likes: dechlq]
- **Text that performs the line**: the words appear as they are spoken, stacked in the empty space above the subject,
  sized by meaning (connector words small: "if it were", "but", "or"; the key word huge, condensed heavy caps) and
  styled like what they say (YELLOW in yellow, GRAY in grey); the speaker points or looks up at them. *The text is the
  demo, so a muted viewer gets the lesson and a listening one gets it twice.* Tools: `text_anim: {by: word}` timed to
  the VO, one overlay per size, `Bebas Neue` / `Anton` / `hook`. [186K: fb 2547005]

