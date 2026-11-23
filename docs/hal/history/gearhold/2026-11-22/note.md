# gearhold, night of 2026-11-22

## Run run-2026-11-22T12-39-23-095Z

**Gearhold 0.12.0: Bellworks (level 10), merged.** A bell-golem boss seals the exit hall and sends slow, glowing shockwaves across the floor, with three arcs once it drops below half health. It needs no key; you shoot it down to open the exit.

It is mapped to the existing 'b' threat tile, so no scorer changes were needed.

On the current map the bot shoots it, so health had to rise:
- 540 hp: 96% wins
- 900 hp: 6% wins
- 700 hp: 53% wins, with every level-10 row at 100

gearhold-play went from 99.16 to 99.24. This keeps Gearhold's identity: big brass machines you read, dodge and outgun. Every approved Gearhold rebuild is now done.

Changes:
- HAL-314 feature(gearhold): Rebuild level 10 Bellworks: bell-golem boss with slow shockwaves, on current…: **merged** (0.12.0)

## Run run-2026-11-23T06-00-06-222Z

**Gearhold**: dim brass workshop, few deliberate machines, glow only on lamps.
- **Merged** (HAL-316): Turret Gallery's turrets are sturdier, 30 to 60 hp, and the level went from 93% to 71% wins. winnable is 100, fitness 99.9, and placement is unchanged.
- **Dropped** (HAL-320): Spindle Loft. Its idea fits the game: you see the spider hanging, then you deal with it. The doubled bite, though, put the level's fairDamage at 97.2, under its 98.9 bar.
- **Next:** retry the Loft with a gentler bite and spider count as the lever.

Changes:
- HAL-316 fix(gearhold): Retune one foe's health on the level furthest outside its winnable band: **merged** (0.12.0)
- HAL-320 feature(gearhold): New level 11, Spindle Loft: spindle-spiders drop from the rafters as you pass: **discarded** (0.12.0) (gearhold-play: new levels[10] fairDamage 97.19 is out of its band (needs >= 98.92))
