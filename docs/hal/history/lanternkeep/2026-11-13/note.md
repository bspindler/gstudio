# lanternkeep, night of 2026-11-13

## Run run-2026-11-13T19-39-37-293Z

### Lanternkeep
Calm, moonlit garden defence.

- **HAL-052 discarded.** Softening Ashen Loop only hurt win rate and inBand, and noSpikes didn't move, so it was all reverted.
- **Next:** look at the night before the spike, which may be too easy, or at how noSpikes measures a jump, rather than softening more nights.

Changes:
- HAL-052 tuning(lanternkeep): Lanternkeep: smooth the night with the sharpest wave spike: **discarded** (implementer blocked: Every softening of Ashen Loop (wave counts, mix and spacing) lowered its win rate and inBand without moving noSpikes, so I could not improve the target measure; all changes were reverted.)

## Run run-2026-11-13T20-13-53-894Z

**Lanternkeep**: a cosy garden defence with a gentle night-by-night climb.
- **Tonight:** I raised Three Fires' enemy strength from 1.05 to 1.5 (HAL-059).
- **Result:** the jump into Ashen Loop shrank, but tension fell too much, so the change was discarded and the game stays at 86.4.
- **Takeaway:** the direction is right; the step was too large.
- **Next run:** a smaller bump around 1.2–1.3, or one extra wave.

Changes:
- HAL-059 tuning(lanternkeep): Lanternkeep: firm up the night before Ashen Loop: **discarded** (0.3.1) (lanternkeep: tension regressed 4.22 (> 1))

## Run run-2026-11-13T21-58-15-764Z

**Lanternkeep:** HAL-067 was discarded. Raising Three Fires' hpMul to 1.25 gave no gain and regressed tension 1.11. Its identity, the gentle garden-defence pacing, is intact. I'll stop adjusting hpMul and instead look at how noSpikes measures the jump into Ashen Loop.

Changes:
- HAL-067 tuning(lanternkeep): Lanternkeep: Three Fires hpMul 1.05 to 1.25: **discarded** (0.3.1) (lanternkeep: no real gain: 0.00 < 0.5; lanternkeep: tension regressed 1.11 (> 1))

## Run run-2026-11-13T23-51-30-095Z

**Lanternkeep: calm moonlit-garden defence.** The scorer showed why inBand is low: the bot wins nights 6, 7, 11 and 13 every time. Cutting Mossy Ford's starting sparks from 340 to 262 lifted inBand from 73.3 to 80 and fitness from 86.4 to 88.6. Tension moved from 49 to 45, and the gate rejected it for dropping more than 1. At 250 sparks the night spiked to 44% wins, so 262 is close to the edge. I'm asking you whether an in-band tension drop should block a change.

Changes:
- HAL-078 tuning(lanternkeep): Lanternkeep: diagnose which night fails inBand, nudge it: **discarded** (0.3.1) (lanternkeep: tension regressed 4.05 (> 1))

## Run run-2026-11-14T00-28-38-604Z

**Identity:** a calm garden at dusk that builds to pressure at night.

**Tonight:**
- **Dropped:** one extra small wave at the end of night 11. Wins tightened to 15 of 16, but inBand held at 73.3.
- **Stagnated:** nothing has been kept for 5 attempts. I'm stopping this line of tuning until you choose: check the bot and how inBand is measured, add new content, or pause the game.

Changes:
- HAL-084 tuning(lanternkeep): Lanternkeep night 11: add one small final wave: **discarded** (0.3.1) (lanternkeep: no real gain: 0.00 < 0.5)
