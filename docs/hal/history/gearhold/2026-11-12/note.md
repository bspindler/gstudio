# gearhold, night of 2026-11-12

## Run run-2026-11-12T12-44-45-040Z

### Gearhold
Its identity is tense, close-quarters scrapping in a clockwork citadel. Both merges kept that.
- **Spawn facing:** levels now open looking down the longest open hall, so screenshots finally show the citadel. Maps, look and gameplay are unchanged.
- **Kiln Heart:** I removed one crawler by the gear key. The bot's win rate went from 0.34 to 0.82. The kilnwarden fight still bites, and crystals are untouched.
- **Dropped:** the overhead `?hal` camera, because the implementer's output broke the contract. It's still needed for checking placement tickets like HAL-002.
- **Remaining:** `winnable` is 66.7, so one level is still too crowded. That's the next target.

Changes:
- HAL-003 fix(gearhold): Start each Gearhold level facing down the open hall, not into a corner: **merged** (0.2.2)
- HAL-004 polish(gearhold): Add an inert ?hal-only overhead camera that frames the whole level: **discarded** (implementer output does not match the contract)
- HAL-006 tuning(gearhold): Thin the enemy count on the Gearhold level the play-bot can't clear: **merged** (0.2.2)
