# Strategy: ideas, the posting plan, positioning, benchmarks

Part of the brain (start at `trends/BRAIN.md`). One lesson per line: the lesson, *why*, the tool to use, proof
`[views: source id]` (`./vtk kb show <id>`). Max 80 lines: merge or retire to `trends/archive.md` before adding.

- **Research → score → one problem, before any script** ("a script about my niche" = generic): list the audience's 10
  problems, frustrations, wants, repeated questions, mistakes, objections, the feelings behind them and their exact words
  (kept per audience, extended each time); score 1–10 (frequency, intensity, fit, content potential, easy in a short,
  curiosity, "about me"); pick ONE; Hook (text + spoken) → Value → Solution → one goal-matched CTA. [74K comments: ddnlim]
- **Idea filter** (~1 in 100 gets made): do we want to make it, can we film it, is the hook good, is there a mechanism,
  will people rewatch and share it; the best ideas come from real-life moments (grandma got free detergent by
  complaining → a video). [4.9M: as7abw]
- **Benchmarks** (her Shorts, 2023): viewed-vs-swiped averages ~70%, hers 85%; retention of 90%+ at ~34 s is her floor
  to blow up. Shares help (a 20% share-to-view rate went with 92% viewed); retention isn't everything (a 70%-retention
  Short still reached 10M on returning viewers). [4.9M: as7abw]
- **Sends beat likes**: a send puts the video in front of someone who trusts the sender. Make the viewer feel smart, and
  when shares are the goal hand them a person to send it to as a playful jab ("send this to the one who'd fail this");
  the brand stays on the viewer's side. [text: 2026-10-06_text_advice]
- **Repost winners** a few months later with a new hook or cover: Cucumber Hack got 37M twice, What's Faster 107M then 35M. [jennyhoyos]
- **Volume doesn't replace the scripted story**: posting daily early on taught her from every retention graph, but since
  Nov 2025 she posts ~13 Shorts a day at a median of 155–460K views; her scripted 2022–25 run had a median of 1.5M. [jennyhoyos; as7abw]
- **Plan the week 3-2-1**: 3 topic buckets × 2 posts + 1 "chaos agent" test (7 a week). One broad bucket for reach, two
  narrow ones for the buyer's pains (more trust per view); after 2 weeks kill a bucket whose 4 videos flopped. [92K: 1ilmgc]
- **Pick the surface by the job** (Meta's own Instagram framework): Reels + carousels reach new people (both are shown
  to non-followers), single photos + Stories keep followers engaged, Lives + broadcast Channels hold the most loyal fans.
  *Reels alone is only the reach job.* The carousel is the save-and-swipe format: a reference people keep (the slide's
  own repost: 344 saves vs 366 likes); IG shows a skipped carousel again from slide 2, then 3, so slides 1, 2 and 3 must each stop a cold scroller with no context (the rest as long as it needs; a mood-matched song keeps swipers) [88K: wzuuhn].
  Tool: carousel slides from a spec (to-build). [meta-slide-engaging]
- **Own a lane (trust beats follower count)**: stack white space on topic, audience slice, delivery, format and look;
  borrow formats from distant niches instead of cloning the leader; hold back case-study proof while small. [92K: 1ilmgc]
- **AI b-roll on a credit budget (Flow)**: lock every shot as text + a still first (text is free, stills cheap), set
  "confirm before generating", 1 output per prompt, and pay only for approved shots; Omni Flash is ~15 credits per 10 s
  at 720p vs ~20 per 8 s on Veo 3.1 Fast. Flow TV clips show their prompts: copy a look before spending. [388K: wj8sgb; 585K: 0vq7ue; +1]
- **AI realism comes from small motion**: close-ups, slow push-ins, locked-off frames, light changes (a glow, a flicker);
  fast action, walking crowds and lip-synced faces break first. Describe the style once per session (it carries over),
  spend the words on lighting, keep the location short, and ask for "handheld smartphone" when it should look native. [4.7K: xzx594; 388K: wj8sgb]
- **AI continuity**: lock character -> location -> shots (character sheet: 3 panels, flat grey light, one face), and start
  each next shot from the previous shot's exact last frame (Flow can't export it; ffmpeg can). Fix a clip with an edit
  prompt instead of regenerating. Places and objects first; people only as hands, backs or out of focus. [4.7K: xzx594; 388K: wj8sgb]
- **Organic first, then ads; the creative is the targeting.** An unknown brand paid ~10x per lead (200 vs 20 AED): a
  stranger needs 10–15 ad views, someone who saw the organic page 1–2. Meta's AI delivers by what the creative *says*:
  plain black statics naming the exact person and pain ("If you're the one who… tired of…") were their best ads. [311K: m2oygu]
- **Find the leak before blaming the video.** Track each step (views → profile visits → store page → installs); a
  5%→12% fix at the first step doubled a business without touching the closer. Good views but no installs = fix the
  profile, bio link or store page, not the next video. [311K: m2oygu]
- **Read the retention graph's shape, fix the one part it points at** (before making more of the same). Crashes in the
  first seconds and stays on the floor → the topic: nobody cares yet (a broader problem people already care about, a
  stronger hook). Steep early drop, then a slow slide → the hook: make the promise clear at once, open a curiosity gap,
  lead with the outcome or the problem. Flat, then a cliff mid-way → one bad moment: cut the context there, add a
  pattern interrupt, move the best insight earlier. Flat, then a steady slide to the end → the value: solve one specific
  problem, give a framework people can use, leave one takeaway they remember. Healthy: a small dip at the start, then
  near-flat (60–75% at the end): strong opening, clear value, pacing, a story that keeps moving. Past the graph (and for
  carousels, which have none): watched or liked but not saved or shared → the value; liked but no action (comments,
  profile visits, installs) → the CTA. [1.4K comments on 2.2K likes: dd3bqb]
- **Seamless AI transitions (Flow)**: make the two shots meet on the same picture: same line direction, colour, light
  direction and camera motion (both diving at full speed). Shot A ends filling the frame with the texture; shot B starts
  top-down on the matching landscape texture, then rises/tilts to the horizon. Give B shot A's exact last frame as its
  first-frame reference, and hide the joint in motion blur at peak speed (zoom-through, 4–6 frames). Small objects in A
  must sit where the big objects sit in B (crumbs -> hay bales). Describe camera moves as the camera's own point of view
  ("FPV drone shot" makes Flow draw a drone in the frame); cut inside A's motion-blur frame. First/last-frame mode only stays continuous when both ends are nearly the
  same layout: change the material in place at the same scale, then reveal the scale in the next clip from that exact
  frame; test at the cheapest setting first. [4.7M: fb 2130876; Veo 3.1 frames guides 2026]
- **Saves come from cliffs, sends come from jabs**: legal-cliff warnings ("the moment your child turns 18…") get the
  highest save rate (~5% vs ~1% for comedy): make them carousels; couple / sibling jabs get the shares: make them
  reels. Earnest product content in a niche only reaches when it's paid; brand demos that worked in 2025 lost 80–90% of
  their median in 2026. [559K, 29.8K saves: family-app-niche-social-study]
- **Captions and tags are labels, the video earns the reach** (2026): sends per reach, watch time and likes per reach rank
  Reels; captions + on-screen text + speech feed search. So line 1 = the on-screen hook in plain search words, a send line
  that names who gets it, a question for comments. Tags: Instagram max 5 (specific, not #viral/#fyp), TikTok 3–5
  search-style, YouTube Shorts the first 3 show above the title, Threads one topic tag, Facebook a sentence + light tail;
  vary the set between posts. Evidence is thin (one small Hootsuite test: keyword captions +30% reach vs hashtags;
  Fanpage Karma: 5 tags ≈ +2%, >5 ≈ −3%): test on your own account. [research 2026-10-14: hootsuite, fanpagekarma]
- **How a post gets pushed, so keep one viewer**: each post is first shown to ~200 mostly non-followers matched by topic;
  strong data → 2K → 20K…, mixed → another 200, weak → it stops. The data: watch time + completion, engagement per view,
  time share of the session (Instagram names watch time, likes per reach and sends per reach). Keep ONE avatar across
  posts (topics rotate, the person watching doesn't): an off-avatar hit blurs who gets the next several. [1.2M: 8cqidx]
- **Four things make people act, five make them comment**: act = a pain they have now · something non-obvious · easy to
  absorb · a short distance to do it (one small step, a big result). Comment = a hard stance · the contrarian side ·
  framing turned up · a topic people already have opinions on · emotion; a deliberate spot-it moment works too. Asking
  outright ("comment below") is engagement bait that platforms demote. [1.2M: 8cqidx; 359K: ipw-mf]
