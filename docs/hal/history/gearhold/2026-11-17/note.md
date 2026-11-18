# gearhold, night of 2026-11-17

## Run run-2026-11-17T12-23-41-211Z

**Gearhold**: not built (run stopped). The paired fix for Press Gallery and The Orrery is still the right next step. It adds a real threat on the main route rather than trimming supply, which keeps the clockwork-fight feel. Levels 1, 2 and 5 must hold their scores.

## Run run-2026-11-17T13-41-27-044Z

**Gearhold:** a brass clockwork crawl.

- **Nothing built:** HAL-184, the balance pass that would bring Press Gallery (0.95 wins) and The Orrery (0.97) down into the 0.5–0.9 band, timed out in the implementer. Nothing changed and fitness stays at 90.12.
- **Next:** retry it as two exact, small edits in one ticket: remove Press Gallery's mid-gallery crystal, and add one main-route threat in The Orrery.

Changes:
- HAL-184 tuning(gearhold): Bring Gearhold's two near-sure-win levels down into the win band: **discarded** (implementer timed out)

## Run run-2026-11-18T00-06-50-986Z

**Gearhold:** Its identity is brass clockwork, with fights you can see coming. Tonight's balance pass was dropped. Press Gallery without its crystal fell only to 88% wins, and a drone in The Orrery's middle hall left it at 97%. Gearhold rose from 90.1 to 92.3, short of the bar. The Orrery needs a layout change, not another enemy.

Changes:
- HAL-199 tuning(gearhold): Press Gallery and Orrery balance: drop one crystal, add one route threat: **discarded** (0.6.1) (gearhold-play: no real gain: 9.34 < 11.95)

## Run run-2026-11-18T01-22-37-272Z

**Gearhold.** The clockwork dungeon is unchanged tonight. The Orrery reroute through the guarded middle hall still wins about 98%, and winnable fell to 74.7 against 77.33, so it was discarded. Changing the route doesn't make this level harder. A timed hazard on the key path, like Cog Bridge's press crossings, is the lever I'd try next.

Changes:
- HAL-203 tuning(gearhold): The Orrery: reroute so the key path crosses one guarded hall: **discarded** (0.6.1) (gearhold-play: no real gain: -2.66 < 12.77)

## Run run-2026-11-18T06-00-03-398Z

**Identity:** brass clockwork, dodging and timing the presses.

The Orrery got one press row on the key route (HAL-209). Wins stayed at 96% and gearhold-play moved only from 90.12 to 90.24, so it was dropped. That row was on-identity but too small. The next try should copy Cog Bridge's three timed crossings in a single exact edit.

Changes:
- HAL-209 tuning(gearhold): The Orrery: add one timed full-width press crossing on the key route: **discarded** (0.6.1) (gearhold-play: no real gain: 1.34 < 14.03)

## Run run-2026-11-18T08-33-09-103Z

**Identity:** a brass clockwork dungeon, with a fetch-the-key route and a walk back.

- **Boiler Stair (HAL-216)**
  - It aims at Gearhold's weak spot: wins that end with health to spare (tension 17.5).
  - It uses only existing enemies, crystals and presses, so it stays on identity.
  - A fix round added a second health crystal early on the route to pass the supply test.
  - gearhold-play rose from 90.1 to 91.7, but the level's own wins, pace and tension were not reported. Whether it actually ends close is unconfirmed.

Changes:
- HAL-216 feature(gearhold): New level 6 'Boiler Stair': key deep inside, guarded room just before the exit: **held** (0.7.0)
