# hyperline, night of 2026-11-19

## Run run-2026-11-19T13-06-12-091Z

**Hyperline**: neon runner on your 0.4.1 camera, where each sector adds a new read.
- FALLING PILLARS shipped on your 👍.
- PENDULUM BLADES, where you hop a blade at the bottom of its swing, was dropped before scoring. The judge-file change was written but not declared as an ask.
- Next: resend it with the HYPERCORE index change (16 to 17) listed in the asks, with tap windows of about 110 ms or more.

Changes:
- HAL-251 feature(hyperline): New sector PENDULUM BLADES: hop a blade as its swing crosses the track: **discarded** (hal-asks.patch was written, but the reply has no "asks")

## Run run-2026-11-20T02-14-12-960Z

**Hyperline 0.11.0, PENDULUM BLADES (held).** A blade swings along the track and you hop it as it crosses. It sits at sector 17, and HYPERCORE moves to 18. The tap windows are 112/125 ms, the p10 window is 117 ms, the intro kill rate is 9% (inside the 8-20% target), and fitness moved from 99.45 to 99.49. It's a new swing-timing read that fits the neon rhythm game.

Changes:
- HAL-257 feature(hyperline): Retry sector PENDULUM BLADES: hop a blade as its swing crosses the track: **held** (0.11.0)

## Run run-2026-11-20T06-00-04-377Z

**Hyperline:** neon read-and-react runner. Tonight's change was dropped.

- HAL-258 lengthened the twin intro's second spike cluster to 8 spikes. bites rose from 97.2 to 99.8, and the p10 window held at 142 ms.
- The gate then found seed 50 not clearable from 0 to 4150 m, and the gain fell short of the bar, so it was discarded.
- The held PENDULUM BLADES sector (HAL-257) was not touched.

Next, retry the intro bite with every seed checked for a clear run before claiming the gain.

Changes:
- HAL-258 tuning(hyperline): Sharpen the one sector intro whose bite is out of the 3-25% band: **discarded** (0.10.1) (hyperline: hard failure: seed 50, full course: not clearable from 0m to 4150m; hyperline: no real gain: 2.58 < 5.98)
