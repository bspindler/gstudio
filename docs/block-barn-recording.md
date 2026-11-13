# Recording your voice for Block Barn

Right now Block Barn talks with the phone's own voice. If you record these clips, the game uses your voice instead. You only need to do this once, and you can do a few at a time.

## What to record

**1. The 26 letters** (A to Z). Say each one the way a book would: "A." (just the letter's name, said warmly). In the files below, `<x>` is the lowercase letter.

**2. The 26 animal names.** One word each: ant, bear, cow, duck, elephant, frog, goat, horse, iguana, jellyfish, kangaroo, lion, monkey, newt, owl, pig, quail, rabbit, sheep, turtle, urchin, vulture, whale, fox, yak, zebra.

**3. The animal noises, only for these 14 animals:** ant (a), bear (b), cow (c), duck (d), elephant (e), frog (f), goat (g), horse (h), lion (l), monkey (m), owl (o), pig (p), sheep (s), fox (x). Make the sound a toddler knows: moo, quack, and so on. The other animals do a little move instead of a sound, so they need no noise.

That is 26 + 26 + 14 = 66 clips.

## How to say them

- Speak slowly and warmly, like you are smiling.
- About one word per clip.
- Leave a short pause before and after (a heartbeat of quiet), so the clip does not start or end with a click.

## File names

Save each clip as a `.m4a` with exactly these names, with `<x>` the lowercase first letter of the animal:

- `letter-<x>.m4a` (for example `letter-c.m4a`)
- `name-<x>.m4a` (for example `name-c.m4a`)
- `noise-<x>.m4a` (only for the 14 animals above, for example `noise-c.m4a`)

## How to record

**On an iPhone (Voice Memos):** open Voice Memos, tap the red button, say the clip, tap stop. Tap the recording, then the pencil/trim icon, drag the yellow handles to cut the extra quiet, tap Trim, then Save. Tap the three dots, then Share, then save to Files or AirDrop it to your Mac. Voice Memos files are already `.m4a`; just rename them.

**On a Mac (QuickTime Player):** File, then New Audio Recording, press the red button, say the clip, stop. Use Edit, then Trim to cut the ends. Then File, then Export As, then Audio Only, which gives an `.m4a`. Rename it.

## Where they go

1. Drop the files into `games/block-barn/audio/`.
2. Add one line per file to `games/block-barn/audio/SOURCES.md`, tagged `studio-owned` (they are your own work).
3. Add each clip's key to `CLIPS` in `games/block-barn/audio/clips.js`.
4. Then ask Claude (or a contributor) to commit it. Nothing changes in the game until that is done.

A parent's own recordings, made in the game's grown-up corner, override these on their own device.

## The device voice in the meantime

Until your recordings are in, you can make the phone's voice much nicer by downloading a Premium voice. The game only uses voices already built into the device.

- **iPhone:** Settings, then Accessibility, then Read & Speak (or Spoken Content), then Voices, then English. Download a Premium voice such as Ava or Zoe (Premium).
- **Mac:** System Settings, then Accessibility, then Spoken Content, then System voice, then Manage Voices. Download Ava or Zoe (Premium) and choose it.
