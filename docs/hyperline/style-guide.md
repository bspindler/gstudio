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

The runner is a hero from Quaternius's Universal Base Characters (CC0), animated with the Universal Animation Library
(CC0). The player picks **M or F** in the Locker. It's free, it's separate from skins, and it can be switched any
time. The hero is scaled to 0.95 units tall, so it never looks as if it clips a low ceiling the sim lets you pass under.

**Skins are outfits** (`outfit3d.js`). They're clothes painted on in a shader, with no textures:
- Each vertex is tagged with its body part (head, torso, waist, upper arms, forearms, hands, thighs, shins, feet).
- An outfit dresses each garment (helmet, top, belt, sleeves, gloves, pants, boots) with a colour, a pattern (hoops, side
  line, circuit, chevrons, gradient, scales, bands), a glow and a metalness.
- Seams between garments glow as neon piping in the outfit's trim colour. The head is a helmet with a glowing visor,
  and a rim light in the trim colour outlines the runner.
- An outfit can move a part to another garment. Gold Standard's tall boots cover the shins, for example.

Each skin keeps its id, rarity, price and source, so the shop, crates and odds are unchanged. New outfits are new
entries in `OUTFITS`.

The physics owns the jump: the hero switches to its airborne loop at take-off and back to the sprint at touchdown. It
rides the ceiling upside down during a gravity flip. The ghost is a wireframe of the same hero. The robot
(RobotExpressive) is retired from the game but stays in the lab.

## Budgets

The runner stays at about 15k triangles or fewer (each hero is 14–15k), and the whole scene at 150k or fewer. The game must hold 60 fps on an
iPhone 12.
