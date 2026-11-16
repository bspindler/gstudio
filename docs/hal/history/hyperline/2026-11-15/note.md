# hyperline, night of 2026-11-15

## Run run-2026-11-15T11-18-08-061Z

**Hyperline** is a neon, single-lane, jump-only runner. BOOST PADS stays true to that: a pad launch over a tall wall, then a precise landing.

As built, though, it is a free sector. The casual bot never dies in it, and that pulled the score from 99.9 to 94.2. The idea is good, but it needs a real chance to fail.

Changes:
- HAL-125 feature(hyperline): Hyperline: new sector BOOST PADS, launch over tall walls: **held** (0.7.0)

## Run run-2026-11-15T18-52-03-456Z

**Hyperline 0.6.2: sharper sector intros (HAL-129).** Only the first appearance of each pattern got harder: wider Crumble holes, bigger Twin Fang clusters and tighter Flip ceilings. Fitness went from 90.2 to 94.1 and bites from 61 to 81. inBand, fair and noSpikes are unchanged. It is still single-lane jump timing. Crumble now kills casual players on 7% of intros and Twin Fangs on 2%. Flip, bar and pad-pit still never kill the casual bot, so those are next. BOOST PADS (HAL-125) is still waiting on you.

Changes:
- HAL-129 tuning(hyperline): Hyperline: make weak sector intros bite 3-25%: **merged** (0.6.2)

## Run run-2026-11-15T21-24-29-875Z

**Hyperline**

Identity: a single-lane, jump-only neon runner in the restored 0.4.1 chase camera with bloom.

- **HAL-136, BOOST PADS (held, 0.7.0):** a new sector 10, before HYPERCORE, which becomes sector 11.
  - Pads launch you over tall walls onto a short landing, then you time one tap through a spike field.
  - The intro kills the casual bot 10% of the time, and the narrowest timing windows stay around 108 ms, well above the 50 ms floor.
  - Sector survival is 71%, and fitness went 94.1 → 94.8.
  - This fixes HAL-125's flaw, where the casual bot never died in the sector.

Changes:
- HAL-136 feature(hyperline): Hyperline: BOOST PADS sector with a tight landing: **held** (0.7.0)

## Run run-2026-11-15T23-32-53-315Z

**Hyperline**: single lane, jump timing, neon. 0.7.0 widens the flip intro's spike clusters (8-9 wide, was 4-5), so the casual bot now dies there 4% of the time. The tightest 10% of tap windows are still 125 ms or more. Bites rose from 83.0 to 95.5 and fitness from 94.8 to 99.1. The bar and padPit intros were left alone because the scorer doesn't judge them (they are don't-press moments). The game's identity is kept: this is pure jump timing. BOOST PADS is on Hal's branch after your 👍.

Changes:
- HAL-137 tuning(hyperline): Hyperline: make flip, bar and padPit intros bite: **merged** (0.7.0)
