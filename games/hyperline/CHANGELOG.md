# Hyperline changelog

Newest first. Each version matches `version` in `game.yaml` and the `createStudio({ version })` call in `index.html`; a test keeps the three in sync. Fixes, tuning and polish bump the patch number, and new features bump the minor number. Hal adds an entry with every change it merges.

## 0.22.0 (2026-11-25)
- A real city street now lines the track: brick buildings with columns, cornices and window frames, their windows
  lit in each theme's colours, and neon signs on the walls as you approach. The tall towers now stand behind them as
  the skyline.

## 0.21.0 (2026-11-25)
- Outfits now come with hair and accessories:
  - Track Suit, Courier, Vaporwave and Glitch show hair, neon shades and your skin tone (pick one of five in the Locker).
  - Firewalker and Apex wear jetpacks whose flames flare when you jump.
  - Gold Standard and Chrome Serpent have capes that stream behind you.
  - There are also headphones, a scarf, a spinning halo, a neon crest and shoulder pads.
- New Large runner setting: a bigger, more detailed runner that ducks under low ceilings. It only changes the look;
  the hitbox and your runs are exactly the same.

## 0.20.0 (2026-11-25)
- Your runner is now a hero, and you pick M or F in the Locker. It's free, and you can switch any time.
- Skins are now outfits: each one dresses your runner with its own top, sleeves, gloves, pants, boots and a
  glowing visor. Patterns include racing stripes, flame chevrons, circuit lines and gold armour, and the seams glow
  neon. You own the same skins as before, at the same rarity.
- Smaller downloads: the runner models are compressed and only your chosen body loads.

## 0.19.1 (2026-11-25)
- The ghost of your best run is now off by default. Turn it on in Settings if you want to race it. (A save from
  0.19.0 keeps the ghost on until you switch it off once.)

## 0.19.0 (2026-11-25)
- Fixed the neon flashes across the top of the screen while running: the robot's hands were being drawn far from its
  body and swept across the view as its arms swung. They're back on the robot.
- New Ghost setting: turn off the replay of your best run if you'd rather run alone.
- Settings now shows the real version number.
- Neon edges and trails are trimmed before they reach the camera, so nothing streaks across the lens.

## 0.18.0 (2026-11-25)
- The runner is now a little neon robot (a CC0 model by Quaternius), running, leaping and riding the ceiling upside
  down. Its jump pose follows your jump exactly. Every skin now dresses the robot, and the locker and shop show it.
- A city skyline streams past on both sides, with lit windows and neon signs, in three themes: Neon District, Flip
  City and Hypercore.
- Colour now has one meaning everywhere: cyan is safe to land on, magenta is a hazard, red is a hazard that is live
  right now, and gold is a reward.
- Speed streaks run along the track edges at top speed.

## 0.17.0 (2026-11-25)
- A new 3D renderer: the track, every obstacle, the runner, the sky, the sun and the mountains are now drawn as a real
  lit 3D scene with neon edges, depth fog, a glowing floor grid and bloom. The gameplay is exactly the same. Phones
  without WebGL keep the previous look, and `?r=2d` forces it.

## 0.16.0 (2026-11-25)
- Three near misses in a row trigger a brief slow-motion beat.
- The camera now kicks up on take-off, dips on landing (more for a bigger fall), and widens a little as you speed up.
- Landings have a thud that gets deeper the further you fall.
- Chips just ahead of you slide toward the runner, and the chip counter pops with each pickup.
- Your first free Neon Crate now comes on your 2nd run, then every 5 runs as before.

## 0.15.0 (2026-11-25)
- Run again is now the big first button on the wreck screen and drops you straight into a new run: one tap, no ready screen. The full breakdown and missions sit under "Run details".
- Coyote time: a tap up to 80 ms after you run off an edge still jumps.
- Hit-stop: a crash freezes the world for a split second before the runner shatters, so the hit lands.
- Paid revive waits until you've played 4 runs and 2 minutes, and the credits revive is always offered first.

## 0.14.0 (2026-11-24)
- New sector DRIFT BLOCKS: a raised block drifts toward you over a spike strip, so hop it as it arrives.
- DRIFT BLOCKS is a little more forgiving: the hop over the drifting block has a roomier take-off window.

## 0.13.0 (2026-11-22)
- New sector SLIDING LEDGE: the far edge of a pit slowly slides in and out as you run, so time your jump to where the ledge is. It comes before HYPERCORE, which is now sector 20.

## 0.12.0 (2026-11-21)
- New sector SPRING SPIKES: a flush panel springs spikes up out of the track just before you arrive, so jump on the rise, not on sight.
- A faint neon gate now stands across the track where your best run ended, and gives a quiet cyan shimmer when you pass it.
- New sector STEPPING STONES: two pits with a short island between them. Jump the first pit, land, and tap again at once for the second. It comes before HYPERCORE, which is now sector 19.

## 0.11.1 (2026-11-21)
- The runner now squashes on landing and stretches at take-off, a quick neon snap that makes each jump read crisply.
- The neon grid and rail glow now drift gently in hue for a second as each new sector begins.
- The runner now leaves a short neon light trail that fades out within a beat, making each jump's arc easier to read.
- When the runner crashes it now shatters into a few neon shards that fade out in under half a second.
- Faint neon ticks on the track now show the best take-off point for each upcoming block, spike and pit, fading as you pass.

## 0.11.0 (2026-11-19)
- New sector PENDULUM BLADES: a blade swings back and forth along the track; read the swing and hop it as it crosses. It comes before HYPERCORE, which is now sector 18.

## 0.10.0 (2026-11-18)
- A near miss now throws a brief cyan spark off the runner's edge.
- New sector FALLING PILLARS: a pillar drops onto the track in front of a short spike strip; wait for it to land, then hop both in one jump. It comes before HYPERCORE, which is now sector 16.

## 0.9.0 (2026-11-17)
- New sector: RISER STEPS. Hop up onto a short raised step, then jump again before the edge to clear the gap that follows. It comes before HYPERCORE, which is now sector 13.
- New sector: STAGGER SPIKES. Spike pairs come at uneven gaps, short then long, so you have to read each gap instead of tapping to a beat. It comes before HYPERCORE, which is now sector 14.
- New sector DROP LEDGES: the track steps down in ledges with a spike strip at each foot, so jump off the edge at the right moment.
- New sector SHUTTLE BLOCKS: a block slides toward you along the track; hop it, then land past the spikes behind it.

## 0.8.0 (2026-11-16)
- Test any sector directly: add ?sector=N to the page address to start an Endless practice run at that sector (1 to 99); your BEST and reached progress stay untouched.

## 0.7.0 (2026-11-15)
- Sector intros are sharper: the Crumble Track and Twin Fangs openers now ask for tighter jump timing.
- New sector BOOST PADS: pads launch you over tall walls onto a short landing strip, then time one tap through the spikes.
- Flip City's first gravity-flip stretch now has wider ceiling spike clusters, so timing your drop matters.
- Tapping fast to jump no longer triggers double-tap or pinch zoom on iPhone Safari.

## 0.6.1 (2026-11-14)
- A cyan neon ripple spreads across the track each time you land, making jump timing easier to feel.

## 0.6.0 (2026-11-13)
- Hyperline's neon now really glows: a soft bloom lights up the rails, edges and sun on phones that support it, and the game looks as before on those that don't.
- New sector: PULSE RAILS. A rail across the track blinks lit and dark to a steady beat. Stay in the air while it glows, land in the dark half, then hop again. It comes before HYPERCORE, which is now sector 10.
- New sector: CRUMBLE TRACK. Floor panels glow, then fall away, leaving holes to leap: jump, land, and jump again. It comes before HYPERCORE, which is now sector 11.

## 0.5.1 (2026-11-13)
- Hyperline: the camera is back to the original angled chase view from 0.4.1.

## 0.5.0 (2026-11-13)
- New sector: SWEEP COLUMNS. After SLOT GATES you now meet rows of slot gates, a jump apart: thread one, land, and jump again in rhythm. HYPERCORE is now sector 9.
- Hyperline: the camera now sits straight behind your lane, with the vanishing point at the centre, so obstacles are easier to read.
- Hyperline: the camera is now higher and further back with a gentler tilt, so the runner looks smaller and you can see more track ahead.
- Game over now has a "Main Menu" button that takes you back to the ready screen and sector picker.

## 0.4.1 (2026-11-12)
- Sound now plays on iPhone even when the ring/silent switch is set to silent. Use the in-game sound setting to turn it off.

## 0.4.0 (2026-11-12)
- New sector SLOT GATES: neon gates with a gap you thread mid-jump, on the way up or down; HYPERCORE now follows it.
- Endless: start a run from any sector you've already reached with the free sector picker on the ready screen; these practice starts never touch your BEST, ghost or missions.
- Near misses now flash a quick neon cyan edge spark and play a bright synth blip.

## 0.3.1 (2026-11-11)
- **Fonts ship with the game.** Monoton and Chakra Petch now load from the game's own `fonts/` folder (SIL OFL), so players' phones no longer contact Google Fonts. The look is unchanged.
- Obstacles are solid and lit, and the course is faster and denser.
- A course preview on the ready screen, the game pauses while settings are open, and small-screen polish.
- Fix: new events are sent as custom events so the ingest accepts the batch.

## 0.3.0 (2026-11-07)
- Sectors, a daily run, ghosts, missions and trails.
- A Canvas2D perspective renderer and a WebAudio synth.
- Pure game logic modules with tests.
- Runs on the studio SDK's no-ingest mode for local play.

## 0.2.0 (2026-10-26)
- First studio version: ported onto the studio SDK. Earlier versions predate this repo.
