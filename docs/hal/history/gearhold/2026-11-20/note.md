# gearhold, night of 2026-11-20

## Run run-2026-11-20T12-28-05-422Z

**Gearhold:** brass-and-furnace dungeon crawl, moving toward levels that each feel different (N-034).
- Cinder mites are rebuilt into Boiler Stair (HAL-265): swarms of three fast, one-hit mites in place of two lone crawlers. A bite of 10 dropped wins to 31%, so the bite is 5 and wins are 51%. The furnace look is untouched.
- Turret Gallery (HAL-268) was a good idea for a cover-and-advance level but failed feel at 84 against 92. The scorer only counts drones, crawlers and similar enemies as threats, so it needs a scorer or bot ask before a retry.
- Regulator Hall is now on main as level 8.

Changes:
- HAL-265 feature(gearhold): Rebuild Boiler Stair cinder mites (fast swarms of three, one-hit) on main: **held** (0.10.0)
- HAL-268 feature(gearhold): New level 9 'Turret Gallery': fixed brass turrets sweep halls with volleys: **discarded** (0.10.0) (gearhold-play: new levels[8] feel 84.17 is out of its band (needs >= 92.08))

## Run run-2026-11-21T06-00-06-027Z

**Gearhold:** Turret Gallery is retried as level 9 (held, HAL-270). It adds fixed brass turrets you read and time, like the presses and rams. That keeps the clockwork identity and gives a genuinely new threat, which is what N-034 asked for. It ships together with the scorer patch, which adds turrets as a threat at the same weight as drones. Without that patch the level fails feel for a reason that isn't about the game. gearhold-play goes from 95.94 to 96.32. Boiler Stair's cinder mites (HAL-265) are also still waiting on you.

Changes:
- HAL-270 feature(gearhold): Retry level 9 'Turret Gallery': fixed brass turrets sweep halls with volleys: **held** (0.10.0)
