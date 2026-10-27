# Formats that work (faceless apps + trends)

Part of the brain (start at `trends/BRAIN.md`). One lesson per line: the lesson, *why*, the tool to use, proof
`[views: source id]` (`./vtk kb show <id>`). Max 80 lines: merge or retire to `trends/archive.md` before adding.

- **Hook + demo**: result first, then 3–5 taps; proof at 1x speed, typing sped up 2–3x.
- **POV / problem → payoff**: chaos cuts about 1 s each, then a hard cut to calm product proof.
- **Numbered list**: 3 items of 4–5 s, ending on a question. **Cheat-sheet**: 10 items in ~15 s, title pinned, number in
  every caption, a counter (fingers) as progress; or all 10 on ONE card from frame 0 over muted b-roll with a boxed
  self-score ("How many do you already have?"). *A reference, so it's saved* (49.1K saves vs 30.3K likes); the score
  alone pulls few comments (17 on 949 likes): add a twist or a second count. Tool: `listicle` + pinned title + counter
  pill. [49K saves: screenrecording-10-04; 344 saves ≈ likes: meta-slide-engaging; 949 likes: derkw4]
- **Named-rule carousel**: 3 rules, one per slide, each with a name people can repeat ("1/ THE 30-DAY RULE (FOR
  MONEY)." in small accent caps), the rule as trigger → action in bold, one grey why line, and one simple picture of
  the before → after state; the cover promises the list, the last slide recaps the 3 areas and asks "which one will you
  start with?". *A named rule is easy to save, quote and send (commenters repeat it by name), and the closing question
  turns the recap into comments.* Product version: the rule is the advice, the real app screen is the picture of how.
  [1.2K likes in 2 h: decfon]
- **"Here's my setup" explainer carousel** (6 slides, one everyday system): 1 plain opinion hook + what's inside → 2 the
  problem in one sentence, text only, "here's what i do instead →" → 3 the real screen numbered 1-4, "that's it." → 4 the
  sorting rule as question / one-word answer ("brain dump? notes. work? work.") → 5 three things to add, each tied to a
  lived moment ("i open this in the target aisle at 8pm") → 6 the to-do in one line + "save this"; caption "which one are
  you making first?". One page colour, ink + ONE accent, lowercase spoken words. *Doable tonight, so it's saved; the lived
  moments make viewers see their own week.* Product version: the product's real screen. [274 likes: demz4c]
- **Diagnosis carousel ("This means…")**: 4 slides repeat one template with one thing changed: the same picture of a
  symptom, a headline naming the cause ("This means your hook is weak."), one mark on the exact spot ("They leave right
  here") and "Fix the X:" with 3 short fixes; the healthy version last ("And this is a good video." + what worked), then
  the CTA alone. *The viewer checks their own case against each picture ("is that mine?"), so every swipe is a
  self-test and the post becomes a checklist to save.* Product version: the symptoms are the audience's real situations,
  each fix ends on the real app screen. (Its look, red pen on notebook paper, is styling, not the lesson.) [dd3bqb]
- **Interactive carousels: the swipe is the game** (2026 carousel trends): something crosses every seam so each slide
  ends mid-motion (a cut-out person walking across a panorama, an icon riding a dotted path through the words); **follow
  the line** (pick an emoji on slide 1, follow tangled coloured lines 3 swipes to your own result: "two more swipes…",
  "almost there…"); **flipbook** (near-identical slides as frames of one motion, a fortune cookie cracking open; holding
  the carousel dots scrubs them like a cartoon); **swipe to zoom** ("You're THIS close to…", each slide closer until the
  tiny words read); **swipe to reveal** (a pixelated photo sharpens slide by slide); **fake call-out** ("[name], you
  didn't pay us. Final warning." → the benefits they got → "okay, there's no [name], we just know you love drama").
  *Every swipe answers a small question and asks the next, so swipes and time on the post climb: what Instagram ranks
  carousels on.* Tools: `output.carousel` + one section per slide with `slide_at` (frame-by-frame slides); one wide
  canvas sliced into slides is to-build. [7K likes, 7.4K comments: demb4r]
- **Before/after split with timers** (or a **"What's faster: X or Y?" race**, 107M: jennyhoyos; or **raw vs edited**,
  labelled halves where every effect is proof, fb 1922283), **group-chat skit**,
  **"things I wish I knew"** (the app appears in one tip only), **rating X**, **6-slide story**, **reply to a comment**
  (the platform's native reply sticker). Templates: `./vtk new --list`. [baseline]
- **Expectation fake-out** (trend, Sept 2026): set up something everyone waits for ("I can't believe this plane flew
  that close ⚠️", a real jet roar swelling for ~5 s) and, at the sound's peak, deliver the message instead (a paper
  plane: "Buy a Toyota") while the roar keeps going. No story needed. Original 24.5M; brands reused it as-is (a car
  dealer, a smoothie shop: 1.9–2.4M). [ig breakdown + sound map: dcy8bl]
- **Kinetic stat explainer** (no voice, music only, ~30 s): a chain of 8–10 single facts, one graphic each (2–3 s), each
  graphic a literal picture of the fact's key noun (people → a crowd filling the frame, a country → its outline drawing on
  with dots, a split → two panels growing to their share, money → a bag / a banknote stream, interests → photo cards
  cycling, buying → product cards drifting in), every number counting into place, and a visual metaphor to finish ("the
  audience you want is in a different room": a door opens, the camera flies through), the logo only after it. *Each
  number is a tiny reveal, so there is always something to wait for, and a muted viewer gets all of it.* Tools: theme
  `kinetic_light`, looks `crowd-fill`, `line-draw`, `stat-split`, `text-swap`, `image-rain`, `photo-cycle`, `float-cards`,
  `sticker-tiles`, `door-reveal`, `logo-reveal`; `counter` with `values:`. [B2B ad, 33 s: screenrecording-10-08]
- **Never-unsee explainer** (faceless motion graphics + VO, ~40 s, one stage): spot-the-difference hook → the obvious
  ruled out → everything else fades to grey and the one difference lifts out, enlarged → the opinion struck for a cause
  ("it's not about ~~taste~~, it's about your **eye**") → one literal picture per fact (an eye morphs into a colour wheel,
  brightness bars count up, a grey street where only the bus has colour) → the viewer runs the test on themselves (the
  same word in red, blue, yellow; numbered dots trace what they read first) → the hook's numbers close the loop (95K vs
  898K, 7×) → "Now you'll never unsee it." *The viewer leaves with a new lens and someone to send it to.* For an app: the
  one detail that separates two near-identical screens, papers or habits. Tools: a light stage (`kinetic_light`),
  `strike`, `counter`, `lifts` / `marks`, `bar-chart`, `line-draw`. [5.1K likes: dechlq]
- **Screen-meme series (the daily engine)**: 6–11 s, the real app screen (a map, a notification, a record, a message
  thread) + one lowercase line of native text, a trending or original sound, no voice-over; the in-app feature *is* the
  joke ("pov: you catch your mom getting coffee without you"). *Cheap enough to post daily, native enough not to smell
  like an ad, and built to be tagged.* The only organic winner in a crowded family-app niche runs on it: ~1.2 posts a
  day, median 20K, hits 2.5–5.3M with 42–176K shares each, while polished brand demos sit near 500. Tool: a `fit` /
  `iphone` screen clip + a lowercase `native_pill` line, 7–9 s. [5.3M: family-app-niche-social-study]
