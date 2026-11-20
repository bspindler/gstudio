# Lanternkeep changelog

Newest first. Each version matches `version` in `game.yaml` and the `createStudio({ version })` call in `index.html`; a test keeps the three in sync. Fixes, tuning and polish bump the patch number, and new features bump the minor number.

## 0.7.0 (2026-11-19)
- New plant: the Thornbriar seeds thorn patches on the path that cut creatures as they cross, grows into the Bramble Hedge or the Barbed Snare, and is available from night 7 and in Night Watch.

## 0.6.0 (2026-11-18)
- New plant: the Moonbell, a slow, soft chime that stills every creature near it for a moment (bosses for half as long), grows into the Lullaby Bell or the Tollbell, and is available from night 6 and in Night Watch.
- Rebalanced The Fork, Mossy Ford and Crosswind so those nights are a fairer fight now that Moonbell is in your arsenal.
- New night 17, Lamplit Orchard: Lampmoths leave the path and dive at your brightest plant, dazzling it so it can't fire until they burn out and flit for the lantern.

## 0.5.0 (2026-11-17)
- The lantern now swells with a soft warm glow when you clear a wave.
- Defeated creatures now dissolve into a few soft, pale moon-motes that drift up and fade.
- New night 16, Burrowing Dark: the Hollow Mole dives under the path where nothing can hit it, so cover the whole road.

## 0.4.0 (2026-11-16)
- Add ?night=N to the page address to jump straight into any night.

## 0.3.2 (2026-11-15)
- Lanternkeep: between waves, a few fireflies drift in to the lantern for a calm breather.
- Night Watch's late waves now swell faster and arrive closer together, so the endless night ends sooner.
- Later nights (6 to 15) now hit harder, scaled to the perks you'd typically own by then, so they stay a real challenge.
- Night Watch: the swelling after night 15 is a little gentler, so more ways of playing last a fair stretch of the night.

## 0.3.1 (2026-11-14)
- The creature path now glows faintly at night, with a slow moonlit breathing, so the route reads more clearly.
- The creature path now glows faintly with a slow moonlit breath in the 3D garden view too, not only the simple view.

## 0.3.0 (2026-11-13)
- A new 3D garden built on three.js (MIT, bundled in the game folder, no outside requests): smooth physically based plants, creatures and lantern; soft moonlight shadows; coloured plant lights; bloom on every glow; reflections; wind-blown grass; rolling hills; a starry sky with a moon and aurora.
- Every model is rebuilt: lathed mushrooms with glowing spots, curling frost fronds with ice tips, spiked ember thistles, glass-like sun crystals, iridescent beetles, translucent moth wings, a wet-skinned Gloom Toad and a paper lantern that sways.
- Quality steps down by itself if a phone can't keep up; "Light effects" in the pause menu picks the lightest look.

## 0.2.0 (2026-11-13)
- Lanternkeep is 3D: a hand-built WebGL2 garden under moonlight, every plant a coloured light, the lantern's light following your lives. Devices without WebGL2 get the flat garden.
- Lantern Flare: tap the lantern (or Flare) to blind and burn everything near it. It charges during waves.
- Every plant's final growth is a choice of two branches (Spore Storm or Deepcap, Hoarfrost or Icicle, Wildfire or Cinder, Solar Lance or Daybreak).
- Two new creatures: the healing Mossback and the Mothmother boss, who bursts into moths.
- Fifteen nights in three regions (Moon Garden, Frostmere, Ember Marsh), each with its own look.
- Lantern perks: every star is a spark; light perks with them and reset them any time. Nothing is sold.
- Night Watch: an endless mode after night 5, with your best wave kept.
- A faster start: the first night begins with a swoop into the garden, a glowing first tile, and the first wave on its own.
- New screens: a live title garden, a garden map, reveal cards for new plants and creatures, callouts, settings for sound, vibration and lighter effects.

## 0.1.0 (2026-11-13)
- First version: a portrait tower defense for phones. Night creatures follow garden paths to your lantern; you grow glowing plants to stop them.
- Four plants with three growth levels each: Glowcap (all-rounder), Frost Fern (slows), Ember Thistle (area), Sunspire (pierces armour, hunts the toughest).
- Five creatures: moths, fireflies (fast), shell beetles (armoured), wisps (ignore frost), gloom toads (boss, costs five lives).
- Ten levels with one to three paths, three-star ratings, saved progress, 2× speed, and gold for calling a wave early.
- The garden is dark; plants and the lantern push the dark back, and the lantern dims as lives drop.
- No purchases and no random rewards.
