# Block Barn: design

Date: 2026-11-13. Status: draft for Brian's review.

## Intent

Block Barn is a game for Brian's granddaughter, who is barely two. She loves blocks, books and animals, and she is
learning fast. The game is a toy barn full of big letter blocks: she taps a block, it turns into an animal, and a
grown-up's voice says the letter and the animal's name ("C c... cow!"). She can stack blocks into a wobbly tower and
knock it down. It's for her first, and for any family with a toddler later.

She plays it **by herself**, holding a phone or tablet. So it must work with no reading, no help, imprecise taps
and a short attention span, and it must be impossible to get lost, stuck, upset or out of the game.

It joins Hal's nightly loop like the other games, so Hal polishes it every night, but Hal is judged differently here:
not by win rates, but by whether a toddler always gets a quick, friendly response.

## What success looks like

- She picks it up, taps, and something delightful happens every single time, from the first tap.
- She hears a familiar voice (a parent's, or Brian's by default) naming letters and animals.
- Over weeks, she starts pointing at the right animal when the voice asks "Where's the duck?".
- She keeps coming back to it because it keeps surprising her a little, not because anything nags her.

## Anti-goals (a failure even if it technically works)

- Anything she can lose, fail, run out of, or wait for: no score, timer, lives, stars to collect, streaks, or locks.
- Anything that pulls her back: no "come back tomorrow", no notifications, no daily rewards, no badges.
- Any money, ad, purchase prompt, rating prompt, sign-in, external link, or button that leaves the game.
- Any data about her leaving the device. Voice recordings never leave the device.
- Text she must read to play. Loud, sudden or scary sounds. Flashing.
- Getting stale like Peekaboo Barn (parents' main complaint: kids lose interest after one try).

## What we learned from existing games (2026-11-13 research)

- **Peekaboo Barn** (closest analogue): loved for being calm, predictable and private, and for letting a grown-up
  record their own voice. Main complaint: same every time, so kids tire of it.
- **Two-year-olds' touch:** they tap reliably and can drag, but struggle to drop something in a precise spot, and
  their taps often miss. Design for tap first, accept several gestures for the same thing, and be forgiving.
- **Sago Mini:** open-ended, no failure, no text. But their playtests found kids asking "what should I do?", so a
  gentle starting invitation helps.
- **Word learning research:** toddlers around 2 learn words best when the app asks them to tap the thing just named
  (contingent interaction). Evidence is mixed, so it's an invitation, never a test.
- **Endless Alphabet:** animation that shows the word's meaning works; parents dislike uppercase-only letters.
- **Parents' top complaints about toddler apps:** ads, purchase prompts, fake close buttons that leave the app.

## How it plays

**The barn.** Portrait, one screen. A warm barn interior. About five big letter blocks sit on the floor (each at
least the size of her palm on a phone). The rest of the alphabet arrives in turn, so every letter comes around.

**Tap a block.** It tumbles, flips, and becomes its animal, sitting on or beside the block. The voice says the
letter, big and small ("C c"), then the name ("cow"), and the animal does its sound or its move. The letter stays
visible with the animal, shown as both cases. Tapping the animal again repeats its name and sound, with a different
little animation each time.

**Stack.** Tapping a block that has already been named hops it onto the tower by itself (no aiming). Dragging a
block onto the tower also works. The tower wobbles. A tap on the tower, or a tower that gets tall, tumbles it down
with a happy clatter, and the blocks bounce back to the floor.

**Where's the duck?** Every so often, when she's been idle a moment, the voice invites her: "Where's the duck?"
and the duck's block glows softly. Whatever she taps says its own name (there is no wrong answer). If she taps the
duck, it gets a big happy dance. The invitation stops after one ask; it never repeats or nags.

**Small surprises.** Animals react to each other (the cat startles at the dog, the duck waddles after the goat).
Now and then a block holds a hidden friend. Variety comes from animation and pairings, never from rewards.

**Forgiving input.** The nearest block or animal answers any tap anywhere near it; a tap on empty floor does
something too (a little dust puff, a hay bounce). Palm and multi-finger taps count as one tap. Lost contact
mid-drag is fine. Nothing needs a double tap, long press or pinch, except the grown-up corner.

**The grown-up corner.** A small, plain icon in a top corner. Press and hold for 3 seconds to open it (a toddler
won't). It holds: record voices, sound on/off, pin favourite letters, a short note on iPhone Guided Access (locks
the device to one app), and "add to Home Screen to keep your recordings". Closing it returns to the barn.

## The 26 animals (agreed with Brian)

A ant, B bear, C cow, D duck, E elephant, F frog, G goat, H horse, I iguana, J jellyfish, K kangaroo, L lion,
M monkey, N newt, O owl, P pig, Q quail, R rabbit, S sheep, T turtle, U urchin (sea urchin), V vulture, W whale,
X fox (shown "f-o-**x**", the x highlighted), Y yak, Z zebra.

Animals with no sound she'd know get a signature move instead (kangaroo bounces, iguana flicks its tongue, turtle
pulls into its shell, jellyfish pulses, urchin wiggles its spines).

## Voices

- **Defaults: Brian's recordings, built into the game.** For each letter: the letter clip ("C c") and the name clip
  ("cow"), 52 clips. Optional: an animal-noise clip per animal ("moo"), up to 26 more. Recorded by Brian, so they
  are original work; recorded in `games/block-barn/audio/SOURCES.md` as "recorded by the studio owner".
- **Parents' voices, on their own device.** In the grown-up corner, a parent picks a letter, taps record, says the
  word, hears it back, and keeps or redoes it. "Back to default" restores Brian's. Recordings are stored in the
  browser on that device (IndexedDB) and never uploaded, sent or logged.
- **Fallback:** for any word with no recording, the device's built-in speech (Web Speech `speechSynthesis`), so
  there is never silence.
- **Animal noises:** Brian's recordings where he makes them; otherwise CC0 clips, each verified on its own page
  and listed in SOURCES.md; otherwise a gentle sound synthesised in code.

**Constraints to know:**
- Recording needs the microphone, which Safari allows only on HTTPS pages. It won't work on the home Wi-Fi
  `http://192.168...` link; it needs the game hosted over HTTPS (for example GitHub Pages, currently off). Playing
  Brian's defaults works everywhere.
- iPhone Safari may clear a site's stored data after a while unused unless it's added to the Home Screen. The
  grown-up corner says so. (An export of recordings can come later if it matters.)

## Art and sound

- **Pictures:** Kenney's Animal Pack Redux (CC0) where it has the animal; the rest drawn in code in the same
  chunky, flat style so all 26 look like one set. Blocks, barn and effects drawn in code.
- **Sound effects** (block clack, tumble, hay bounce): synthesised in code, soft and low. No sudden loud sounds.
- Every non-code asset is CC0 or Brian's own, with its source recorded next to it (the studio rule).

## Privacy and the studio's rules

- Block Barn is **child-directed** (target age 2+). The studio's market rules today aim at "13+ / child-safe" and
  cite COPPA, so this game must collect nothing: the SDK runs with **no events sent, no purchases, no rating
  prompt, no feedback prompt** for this game. Nothing about her or her family leaves the device.
- `game.yaml`: `targetSegment` names toddlers (2+), `ageRating` stays `null` until a store release is decided.
- Any public release (Pages for others, or an app store, e.g. Apple's Kids category) is a separate decision for
  Brian; this design keeps it possible (no analytics, no links out, a grown-up gate on settings).

## Hal and Block Barn

Hal improves it nightly like the other games, with these differences:

- **Hal may not touch** the voice recorder, the stored recordings, Brian's audio files or SOURCES.md, or the
  privacy settings (no events, no purchases, no prompts). These are off-limits like `infra/`.
- **Hal may not add** sound or picture files; anything new it makes is drawn or synthesised in code.
- **Hal's checks for this game** (its scorer), each a measure that is 100 when healthy:
  - *responsive*: every tap (on a block, an animal, the tower, the floor) gets a visible response quickly;
  - *noDeadEnds*: from every state the barn reaches, a tap still does something, and the game never leaves the
    barn except into the grown-up corner;
  - *bigTargets*: every tappable thing stays at least palm-sized on a phone screen;
  - *alphabet*: all 26 letters are reachable in normal play and each has its picture and a voice (recording or
    fallback);
  - *calm*: no flashing, no loud jumps in volume, nothing on a timer that she can miss.
- The anti-goals above go into Hal's planner prompt for this game, so it never proposes scores, rewards or nudges.
- New animals or letters are not a thing here (the alphabet is fixed); new animations, reactions and surprises are.

## Decided by Brian

- Block Barn first (over Animal Peekaboo and Little Library). Full A to Z from the start, with the list above.
- She plays alone on a phone or tablet.
- Parents can record their own voices; Brian records the defaults.

## Calls made after the builder check (Claude's, not Brian's)

- **Audio without the network.** Games may not call `fetch` (studio compliance and Hal's network tripwire). Clips
  play through `new Audio(url)` / `<audio>` from the game's own folder; parent recordings are `MediaRecorder` blobs
  kept in IndexedDB and played from object URLs. No WebAudio decoding of files. Clip format: AAC `.m4a` (what
  iPhone Voice Memos records; plays in Safari and Chrome), named `audio/letter-<x>.m4a`, `audio/name-<x>.m4a`,
  `audio/noise-<x>.m4a`, normalised to a similar loudness. A missing clip falls back to `speechSynthesis`.
- **It ships before Brian records.** The first build uses `speechSynthesis` for every voice and works fully;
  Brian's clips drop into `audio/` later with no code change.
- **Enforcing Hal's limits** is part of the build: path rules in Hal's tripwires lock `games/block-barn/recorder.js`,
  `games/block-barn/audio/**` and the game's privacy settings, and a rule refuses any new non-code asset in this
  game. The recorder lives in its own file so a path rule can lock it. (These are protected Hal files; the operator's
  session makes these changes, not Hal.)
- **Hal's scorer is browser-driven**, like `gearhold-play`: Playwright drives the game through a `?hal` hook,
  taps every kind of target, and measures response time, target sizes, reachable states and flashing. *alphabet*
  checks that every letter has its picture and a voice source (clip, recording or fallback), not audio quality.
  The game is added to the studio's games list, screens and history like the others.
- **Arrival order** is a fixed rotation through A to Z (a seeded shuffle), so every letter appears within a bounded
  number of taps.
- **Testing:** on `localhost` (where the microphone works) and in the browser on the home Wi-Fi, where the grown-up
  corner says recording needs the secure (HTTPS) version. A real-iPhone check of recording waits for HTTPS hosting.

## Decided by Brian after the builder check (2026-11-13)

- **Child-directed flag.** `game.yaml` gets `childDirected: true`. For such a game the studio compliance check is
  stricter, not looser: instead of requiring `level_start` / `level_end` events and `feedback.maybePrompt(`, it
  requires the SDK in no-ingest mode (endpoint fixed to `''`, never `resolveEndpoint`) and forbids
  `purchase.offer(` and `feedback.maybePrompt(`. The no-network rule still applies.
- **A family game, outside the stage gates.** Hal polishes it nightly, but it never enters the promotion pipeline
  (no gate can pass without events). Any public or app-store release is a separate decision for later.
- **Brian's recordings get a new allowed tag, `studio-owned`,** in Hal's asset-source rule (beside `hal-generated`,
  CC0, public domain, OFL-1.1). His voice stays his; it is not released as CC0. Hal itself may not use the tag.

## Left to the builder

The exact barn art, animation timings, the number of blocks on the floor (about five), how often the invitation
comes, how "tall" a tower gets before it tumbles, the slug (`block-barn` suggested), and how the scorer measures
"quickly" and "palm-sized", within the intent above.
