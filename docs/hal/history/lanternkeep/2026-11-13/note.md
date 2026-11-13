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
