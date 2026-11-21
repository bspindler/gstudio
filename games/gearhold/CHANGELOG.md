# Gearhold changelog

Newest first. Each version matches `version` in `game.yaml` and the `createStudio({ version })` call in `index.html`; a test keeps the three in sync. Fixes, tuning and polish bump the patch number, and new features bump the minor number. Hal adds an entry with every change it merges.

## 0.10.0 (2026-11-20)
- New Gearhold level 9, 'Turret Gallery': brass turrets sweep the halls and fire three-shot volleys along a locked line, so read the glow, step out, then cross.

## 0.9.0 (2026-11-19)
- The Orrery: the kilnwarden in the exit hall now stands by the exit arch and is a little less tough, so the walk home is a fair fight.
- New level 8, Regulator Hall: wreck three steam regulators on a long, winding route past a guarded kilnwarden crossing to unseal the exit. No key this time.

## 0.8.0 (2026-11-18)
- Boiler Stair now has its own furnace look: dim red-orange boiler lamps along the walls and slow rising steam wisps.
- The Orrery: timed gear presses now guard the top-right chamber and the key room, so you have to time your dash to the gear key.
- The Orrery: a kilnwarden now wakes in the exit hall once you take the gear key, so the walk home is a real fight.
- New level 7, Ram Foundry: brass rams rear up, glow and charge in straight lines. Sidestep them and shoot them while they reel from the wall.

## 0.7.0 (2026-11-17)
- New level 6, Boiler Stair: the gear key is hidden deep in the boilers, and the walk back to the exit passes one last guarded hall.

## 0.6.0 (2026-11-16)
- New level 5, Cog Bridge: a long clockwork walkway with a drone, a crawler and a kilnwarden, and gear platforms you have to wait on before they line up.
- Add ?level=N to the page address to start Gearhold straight at that level (1 is the first; a number past the last level starts the last one).

## 0.5.3 (2026-11-15)
- Internal only, nothing changes for players: the list of on-screen overlays left out of the test robot's top-down level pictures now lives in the game code.

## 0.5.2 (2026-11-15)
- Gearhold now renders with three.js, with soft glow around its lamps and light sources, and keeps the plain WebGL2 renderer as a fallback.

## 0.5.1 (2026-11-15)
- Sparks, smoke, steam, shake and the muzzle flash now use their own randomness, separate from how enemies move and shoot. Nothing looks or plays differently; it just means a visual tweak can no longer change a fight.

## 0.5.0 (2026-11-14)
- Gearhold: toned down the amber glow so walls, floors and brass are easier to see; only real light sources still shine.
- Gearhold: removed the sideways oval screen glow; the screen-edge shading is now round and fainter.
- Terrace of Dials: ticking brass gear presses now guard the rooms on the way to the exit, so time your dash across the beat.

## 0.4.0 (2026-11-13)
- A brass tick now flashes at the screen edge to show which direction damage came from.
- Picking up the gear key now gives a brass glow around the screen edge and a clockwork ratchet-and-bell chime.
- Wrecked clockwork foes now burst into a puff of brass steam and tumbling cogs.
- Exit arches now glow brass with a slowly turning ring of cogs once you pick up the gear key.
- New level 4, Press Gallery: a long brass gallery where gear presses thump in a steady, learnable wave. Each one glows hot just before it slams.
- Gearhold: landing a shot now gives the crosshair a brass ring-and-tick flash and a soft click.

## 0.3.2 (2026-11-12)
- A small brass compass on the HUD now points to the gear key, then to the exit arch once you hold the key.

## 0.3.1 (2026-11-12)
- Sound now plays on iPhone even when the ring/silent switch is set to silent. Use the in-game sound setting to turn it off.

## 0.3.0 (2026-11-12)
- Each level now opens looking down the citadel's longest open hall instead of into a wall corner.
- Kiln Heart is a little less crowded: the tick crawler guarding the gear key has been scrapped, so you reach the kilnwarden with more fight left in you.
- Picking up a level's gear key now saves a checkpoint on your device: if you're wrecked after that, reboot at the key instead of replaying the whole sector.

## 0.2.1 (2026-11-11)
- Terrace of Dials: a repair crystal now sits within reach of the main path, so the first level offers a little fair healing.

## 0.2.0 (2026-11-11)
- **A new world, the clockwork citadel,** in real-time WebGL 3D, with lighting, bloom, high-resolution art, particles and a new HUD.
- **A new hand cannon:** a heavy 3D revolver held in a partly cyborg hand, pointing into the scene.
- **Controls:** free look, precise aim and momentum movement.
- Gameplay is the same as before for players. Only Hal's robot uses the test hook added in this version: it is inert unless the page is opened with `?hal`, and in that mode it sends nothing.
- These changes shipped in the game file after 0.1.0 without a version bump, so they are recorded here.

## 0.1.0 (2026-11-07)
- First version: a retro raycast first-person shooter.
