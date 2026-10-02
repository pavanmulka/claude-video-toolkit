# Phone plates

Footage of a hand holding a phone whose screen is flat chroma-key green. `layout: {type: plate, plate: <source>}` warps a
real screen recording into the screen (see CLAUDE.md, Layouts). Sources resolve here by name:
`sources: {hand: plates/hospital_waiting_room.jpg}`. Generic places only: no brands, logos or faces.

| plate | place | use with |
|---|---|---|
| `hospital_waiting_room.jpg` | ER waiting room at night, teal/plum chairs, vending machine, cold light (1536x2752) | `zoom: 1.0` (text above the phone: pill y 245, captions y 345) |

**Stills beat video plates.** AI hand motion looks fake and makes small UI text shimmer; a still plate is rock steady.
Push-in (`push: [1.0, 1.04]`) only with `zoom` ≥ 1.15, where the plate has margin around the frame.

**Make a new one (free):** Google Flow, image, Nano Banana Pro, 9:16, x2, then download at 2K. Prompt pattern:
"Photoreal vertical close-up photo shot on a smartphone at night in <place>. A person's hand holds a modern iPhone upright
very close to the camera, facing the camera straight-on; the phone fills about 75% of the frame height and is centred. The
iPhone screen is a perfectly flat, uniform, solid chroma-key green (#00FF00) with no reflections, no glare, no text and no
icons, edge to edge inside thin black bezels, with the black Dynamic Island pill at the top. The thumb and fingers hold the
sides and bottom edge and do not cover the screen. Background: <place details>, heavily out of focus. <look>, realistic skin."
Check: flat green, island visible, fingers off the screen, phone straight. Add a row to the table above.
