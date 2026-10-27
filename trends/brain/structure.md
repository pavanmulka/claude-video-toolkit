# Structure & pacing

Part of the brain (start at `trends/BRAIN.md`). One lesson per line: the lesson, *why*, the tool to use, proof
`[views: source id]` (`./vtk kb show <id>`). Max 80 lines: merge or retire to `trends/archive.md` before adding.

- **Length and cut per platform** (one spec, `variants:`): TikTok 15–30 s (brand engagement; creators 10–20 s, dense);
  Reels 30–60 s for reach, very visual with captions on every line, made to share; Shorts a slower story (her best: 34 s;
  under 30 s needs 100%+ retention); single-feature demos 20–35 s. The same video got 1M views on one platform and 1K
  on another. [baseline; 4.9M: as7abw, 2023]
- **A visible mechanism toward the promised end**: "3 things we need" with the list on screen, MrBeast's closing circle,
  a tally, a checklist, fingers counting down to 10. Viewers know what's at the end and how far they are. [4.9M: as7abw;
  frame sheets: jennyhoyos; 49K saves: screenrecording-10-04]
- **One focal point per shot, a new picture every 1.5–3 s** (3–6 per 10 s). *Cuts focus attention (peak 0.7 s after the
  cut); visual complexity costs 26% of it; more cuts help only up to a point; viewers leave on static visuals and slow
  intros.* Never freeze: push in slowly. Punch-ins of 10–15% on alternate shots; `autozoom` on each tap; proof moments
  1.5–2.5 s at 1x. [[JAMS, Mar 2026](https://link.springer.com/article/10.1007/s11747-025-01137-x); [Internet Research, Feb 2026](https://www.emerald.com/insight/content/doi/10.1108/intr-07-2023-0521/full/html); baseline]
- **Best insight early, no context before it**: a mid-video cliff comes from a stretch of setup or a beat that only
  explains. Cut it, move the strongest point (the surprising fact, the best question, the proof) into the first third,
  and put a pattern interrupt (a new picture, a sound hit, a twist) where viewers were leaving. Carousels: slide 2 is
  the best insight, not background (Instagram re-shows a skipped carousel from slide 2). [dd3bqb; meta-slide-engaging]
- **Re-hook wherever the curve would slide, not once**: retention always falls; a re-hook gives the viewer a fresh
  reason to stay and the curve bumps back up. Three families, pick by what the beat needs: **open a new loop in words**
  (a question, "but there's one problem…", tease the result, a twist, "and it gets worse", an exception "unless…", hold
  the answer back, a prediction, "that's not even the best part", open the next question, call back to the hook);
  **pay a small loop with proof** (show it, a real number, an example, A vs B, before → after, a mistake, correct
  yourself, a warning "don't do this yet", a challenge "can you spot it?"); **change the picture** (new shot or angle,
  b-roll, a prop, a punch-in, a new place, a format switch, a second voice, a beat of silence before the payoff). Pay
  each loop before or as the next one opens, so the chain never stalls. Carousels: each slide's headline is one of
  these moves, so every swipe answers one loop and opens the next. Tools: `text_anim`, `lifts`, `marks`, `zoom`
  transitions, `sfx` per the sound job map. [10.1K likes, 5.8K comments: ddbpbr; jennyhoyos]
- **A new picture doesn't need a cut**: 40 s on one stage with zero cuts still changes every 2–3 s, because each graphic
  turns into the next (the cards grey out and one word lifts free, an eye becomes a colour wheel, a chart becomes a
  street). *The eye never loses its place, so it never has to re-orient; the change holds attention, not the cut.* Tools:
  overlays with `anim` in / out on a `color: transparent` stage, `lifts`, `grow` / `shrink` / `flood`. [5.1K likes: dechlq;
  pm launch-film]
- **Loop endings pay**: Shorts replays count as views (since March 2025). End on a frame that matches the start
  (`output.loop`); no fade to black; end card at most 1–1.5 s. Reveal-first videos open on the result ("Tada.") and end
  on the countdown to it ("3, 2…"). [YouTube, Mar 2025; baseline; 65M: jennyhoyos]
- **A number that moves is watched until it lands**: count into each figure (0.6–1 s, ease out), even from a nearby value
  ("76%" → "70%", "29 to 49" → "25 to 44"), and let the previous number roll into the next one. The landing value is
  always the real one. Tools: `counter` overlays (`values: [[29, 25], [49, 44]]` for ranges), `stat-split`,
  `stat-counter`. [screenrecording-10-08]
- **Two loop levels, then pay exactly what you promised**: one long loop opened in the first 3 s that only the last line
  closes (the result, the score, the twist), with short loops opened and paid every 2–4 s under it; give a strong piece
  early so staying feels worth it, and tease that a better one is coming ("the last one is the one nobody has"). The
  payoff must match the promise (a "tie" ending loses the returning viewer). Music can carry the tension: a build under
  the middle cut dead on the turn, a new mood per section. [257K: g-6tiu; 359K: ipw-mf; 2.9M: t5z-q1]
