# Start here

Welcome. This guide takes you from a fresh Windows laptop to your own game running on your phone. Go through it in order the first time. Dad will sit with you for the setup part. After that, you're mostly working with Claude, and Dad reviews what you make.

Every command below goes into **PowerShell** (the terminal inside VS Code is PowerShell by default). Copy a command, paste it, press Enter. Anything in `<angle brackets>` is a placeholder: swap in your own value and drop the brackets.

## 1. What this is

This repo is a small game studio that mostly runs itself. It holds the games, and the machinery that takes a game from an idea, through testing with real players, to the app stores. Small HTML5 games live in `games/`, one folder each. They're plain web pages: no build step, just open them in a browser.

Your games are real studio games. They go through the same steps and follow the same rules as every other game here, and if players like one, it can go all the way to the app stores. The goal for your first month is simple: **make your own small game and play it on your phone.** Then make another.

## 2. The hard rules (and why)

These never change, for any game, ever. The tests check some of them automatically, and Dad checks the rest when he reviews your work.

1. **No gambling, no crypto, no tokens, no prizes worth real money.** Nothing you can buy ever contains a random reward, and any random reward a player earns shows its odds. *Why:* gambling-style games hurt people (kids especially), and they're illegal or banned in many places and on the app stores.
2. **Follow every platform's rules.** Only use a platform's official tools and APIs (the ways it officially lets programs talk to it). No bots pretending to be people, no fake accounts, no fake reviews, no buying likes or downloads, and no scraping (having a program copy data off a site) where the site's terms say no. *Why:* it's dishonest, and breaking the rules gets the whole studio banned, not just one game.
3. **No real charges.** In test builds, "buy" buttons are fake: they tell the player the item is free during the beta and just note that someone was interested. Real money only ever goes through the official app stores. *Why:* charging people outside the stores breaks their rules and players' trust.
4. **Protect kids. No dark patterns.** No personal data from anyone under 13. No fake countdown timers, no fake "only 3 left!", and no nagging after a player says no. If something is limited, the limit and end date are real. Age ratings are answered honestly. *Why:* lots of players are young, and tricking people into spending is wrong even when it works.
5. **Collect as little as possible.** Players are anonymous IDs, never names or emails. *Why:* data we don't collect can't leak, and what we tell the stores we collect has to be true.
6. **Original ideas only.** No copying other games' characters, art, music or names. *Why:* it's someone else's work, and copies get taken down.
7. **No secrets in files.** Never put a password, key or token in any file in this repo. *Why:* anything committed to Git stays in its history forever, where anyone with access can find it.

If you're ever unsure whether something breaks a rule, **ask Dad before you build it.**

## 3. One-time setup on Windows

Do these once, in order.

**Git for Windows** (keeps track of every change, and Claude Code needs it too). Download it from <https://git-scm.com/download/win> and run the installer. **Keep every default option.** The repo has its own settings file (`.gitattributes`) that handles line endings, so you don't need to change anything there.

**Node.js** (runs the tests and the local game server). Either download the **LTS** installer from <https://nodejs.org>, or run:

```powershell
winget install OpenJS.NodeJS.LTS
```

Close and reopen PowerShell, then check that it worked (you need version 22.13 or newer):

```powershell
node --version
```

**VS Code** from <https://code.visualstudio.com>. Then open the Extensions panel (the four squares on the left), search for **Claude Code** (by Anthropic) and install it. Open it and sign in with **your own** Claude account.

**GitHub.** Make a GitHub account if you don't have one yet and tell Dad your username. He'll send you an invite to the repo: accept it from the email or from <https://github.com/notifications>.

**Tell Git who you are** (use the email from your GitHub account):

```powershell
git config --global user.name "<Your Name>"
git config --global user.email "<you@example.com>"
```

**Get the code.** Dad will send you the exact link. It looks like the one below. First close and reopen PowerShell, so it knows about the programs you just installed (otherwise `code .` says it isn't recognised). Then:

```powershell
New-Item -ItemType Directory -Force $HOME\code
cd $HOME\code
git clone https://github.com/krakendevlord/<repo-name>.git
cd <repo-name>
code .
```

We use `$HOME\code` rather than Documents because Windows often syncs Documents to OneDrive, and OneDrive syncing thousands of project files breaks `npm install` and causes clashing copies. Keep code out of OneDrive.

If `code .` still isn't recognised, open VS Code yourself and use **File → Open Folder** to pick the `<repo-name>` folder inside `code`.

The first time Git talks to GitHub, a browser window opens so you can sign in. That's normal.

**Install and check.** In VS Code, open a terminal (menu **Terminal → New Terminal**) and run:

```powershell
npm install
npm test
```

`npm install` downloads the tools the project uses (this takes a minute). `npm test` runs every test. You should see them all pass in green.

> **If PowerShell says "running scripts is disabled on this system"**, run this once, then try again:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

**Set up your Claude.** Copy the two starter files from `docs/contributor/` into place. They tell Claude to teach you step by step, and they stop it from doing a few things it shouldn't (like pushing to `main` or editing the studio's rules):

```powershell
Copy-Item docs\contributor\CLAUDE.local.md.example CLAUDE.local.md
New-Item -ItemType Directory -Force .claude
Copy-Item docs\contributor\settings.local.json.example .claude\settings.local.json
```

Git ignores both copies, so they're yours: change `CLAUDE.local.md` to fit how you like to learn. Always open the repo's top folder in VS Code (the one with `package.json` in it), so Claude finds these files.

## 4. Your first game

Make a branch first (section 7 shows how: `git switch -c star-catcher`), so your game has its own safe place. Pick a name: lowercase letters, numbers and dashes only, like `star-catcher`. Then:

```powershell
npm run new-game star-catcher
npm run dev
```

The first command makes `games/star-catcher/` with two files: `index.html` (the game) and `game.yaml` (its name and details). The second starts a local server. Open <http://localhost:5174/star-catcher/> in your browser and play.

Now make it yours. Open `games/star-catcher/index.html` and look for the **`CHANGE ME`** comments: colours, title, lives, how fast the circles fade. Change one thing, save, refresh the browser, and see what happened. A good first ask for Claude: *"Walk me through how this game works, one part at a time."*

To stop the server, click in its terminal and press **Ctrl+C**.

A few things to know:

- The game talks to the studio through the **SDK** (`packages/sdk/studio-sdk.js`). It records things like "level started" and asks for feedback. Keep those calls in, and use only the SDK for that kind of thing.
- Your starter game has no purchases. **If you want to sell anything, even pretend, ask Dad first.** It has to go through the SDK's `purchase.offer(` (the fake-door test from rule 3).
- `npm test` checks every game against the hard rules. **If it fails, read the message**: it's written in plain English and says what's wrong and where. Ask Claude to explain it if it's unclear. Fix the game, and **never change or delete the test to make it pass.**

## 5. Play it on your phone

```powershell
npm run dev:lan
```

This is the same server, but your phone can reach it too. It prints some addresses, like `Games         http://192.168.1.23:5174`. On your phone:

1. Join the **same Wi-Fi** as your laptop.
2. Open the address it printed, plus your game's folder, for example `http://192.168.1.23:5174/star-catcher/`.

Windows treats a new Wi-Fi network as **Public** (locked down) until you say otherwise. Set your home Wi-Fi to Private first: **Settings → Network & internet → Wi-Fi →** click your network **→ Network profile type → Private**. Only do this for your home network.

The first time, **Windows Firewall** asks whether to allow Node.js. Tick **Private networks** only and leave **Public networks** unticked. Only do this on your **home** Wi-Fi, never at school or in a café: while it's running, anyone on the same network can reach it, and it has no password.

If your phone can't connect, check you're on the same Wi-Fi, then ask Dad (the firewall setting may need fixing).

## 6. Test builds (share with friends)

Every time Dad merges your work into `main`, the games are published as **test builds** on a website. Use the test-builds link Dad shares. Anyone with the link can play; it's perfect for family and friends. Each game shows a small "test build" badge, search engines are told not to list it, and nothing about the players is collected.

## 7. The Git loop

Here's how every change gets from your laptop into the studio. You never change `main` directly. You work on a **branch** (your own copy of the code to change safely), then ask for it to be merged with a **pull request** (PR).

**Start something new:**

```powershell
git switch main
git pull
git switch -c <short-name-for-the-change>
```

`git pull` gets the latest code. `git switch -c` makes a new branch and moves you onto it, for example `git switch -c star-catcher-first-version`.

**Save your work** (do this often, every time something works):

```powershell
npm test
git status
git add games/<your-game>
git commit -m "<what you changed, in a few words>"
```

`git status` shows what changed. `git add` picks what goes into the save. `git commit` saves it with a message.

**Send it to GitHub:**

```powershell
git push -u origin <your-branch-name>
```

The first push prints a link. Open it and click **Create pull request**. (Or go to the repo on GitHub and click **Compare & pull request**.) Say what you made and anything you want Dad to look at.

**Wait for review.** GitHub runs the tests on Windows and Linux (the checks on the PR page), and Dad reviews it. If he asks for changes, make them on the same branch, then `git add`, `git commit` and `git push` again: the PR updates by itself. When he approves, he merges it.

**After it's merged**, go back to `main` and tidy up:

```powershell
git switch main
git pull
git branch -d <your-branch-name>
```

If `git branch -d` says the branch is "not fully merged", check that GitHub shows your PR as **Merged**. If it does, it's safe to use `git branch -D <your-branch-name>` (capital D) instead. That message appears because of the way GitHub merges, not because your work is lost.

## 8. When you're stuck

1. **Read the error message.** Most of them tell you exactly what's wrong.
2. **Ask Claude.** Paste the message and ask what it means. Ask *why*, not just *how to fix it*.
3. **Ask Dad.** If you've been stuck for a while, or something feels like it might break a hard rule, ask him. Say what you tried and paste the error. Claude can help you write the question.

Being stuck is normal. It's how everyone learns this.

## 9. Leave these alone for now

These folders run the studio itself. Look around if you're curious, but don't change them, and don't let Claude change them, unless Dad asks:

- `packages/core`: the studio's engine (rules, stage gates, the gateway)
- `services`: the server that collects game events
- `adapters`: how the studio stores its data
- `infra`: the cloud setup
- `policy.yaml`: the studio's rules about what needs Dad's approval
- `markets.yaml`: which countries games launch in

Your space is `games/`. Have fun.
