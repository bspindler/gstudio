# Hyperline style guide: "synthwave arcade, readable first"

Every Hyperline asset and effect follows this page. It applies to the 3D renderer (`render3d.js`). The 2D fallback
keeps its old look.

## Colour has meaning

| Meaning | Colour | Used for |
| --- | --- | --- |
| **Safe** | Cyan `#22F0FF` (the deeper `#2B6BFF` for shading) | Track edges, blocks you can land on, moving platforms, jump pads, the ceiling track in a flip, a rail while it's dark, take-off ticks. |
| **Hazard** | Magenta `#FF2BD6` for a static hazard, red `#FF2B5E` for one that is live right now | Spikes, low ceilings, slot-gate posts and slabs, pendulum blades, a rail while it's lit, a crumble panel about to drop. |
| **Reward** | Gold `#FFE45C` (the deeper `#FF9F1C` for shading) | Chips, the best-distance gate, text pops for streaks and missions. |
| **Runner** | The skin's own colours | The runner, its trail and its glow. The default skin is cyan, the same as safe ground. |

Nothing else glows. The backdrop (sky, sun, mountains, skyline, floor grid) carries each sector's palette and mood,
but it stays dimmer than the playfield. The only things that bloom hard are neon edges in the three meaning colours.

## Silhouettes come first

Every obstacle has to be recognisable as a black shape with no colour, at full speed on a 6.1" phone, at least 1.2 s
before the runner reaches it:
- Spikes are sharp pyramids, always in pairs across the track.
- Low ceilings are tall slabs with horizontal stripes, hanging at head height.
- Slot gates are a post and a slab with a gap between them.
- Blocks are plain boxes. A falling pillar shows its landing footprint first.
- Blades hang from a rod and pivot.
- Rails are flat strips with posts. When lit they rise and glow red.

## Layers, back to front

1. The sky gradient, then stars.
2. The sun, with synthwave cuts across it.
3. A mountain silhouette with a neon ridge line.
4. **The skyline:** instanced towers on both sides of the track, with lit windows and the odd neon sign. Because it is
   real 3D, the towers stream past at running speed and give the scene its sense of speed.
5. The floor grid, fading into the horizon fog.
6. The track and the playfield.

## Three themes

| Theme | Sectors | Windows and signs | Mood |
| --- | --- | --- | --- |
| Neon District | 1–7 | Magenta and cyan windows; signs read ARCADE, NOODLES, OPEN | Warm night, busy streets |
| Flip City | 8–14 | Teal and amber windows; signs read SYNTH, VOLT, 24/7 | Cooler, taller towers |
| Hypercore | 15–22 | White and violet windows; signs read CORE, HYPER, MAX | Sparse, tall, bright |

Every sign word is our own text: no brands, logos or other games' names (hard rule 6).

## Runner

The runner is the Quaternius robot (RobotExpressive, CC0), about 0.92 units tall, so it never looks as if it clips a
low ceiling it passes under. Its materials are ours:
- **Main:** the skin's first colour, emissive.
- **Black (trim):** the skin's second colour, glowing.
- **Grey:** dark chrome.

The physics owns the jump. The pose follows the physics: a take-off frame, then the airborne pose held until
touchdown. The runner rides the ceiling upside down during a gravity flip. The ghost is a translucent outline of the
same robot.

## Budgets

The runner stays at 15k triangles or fewer, and the whole scene at 150k or fewer. The game must hold 60 fps on an
iPhone 12.
