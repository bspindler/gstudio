# Web Game Portals: CrazyGames, Poki, itch.io, GameDistribution

Researched 2026-10-25. Primary sources are the portals' own docs and terms. Where only secondary sources exist, the entry says so. Most portal doc pages carry no "last updated" date, so the date given is when we read them.

## Summary table

| | CrazyGames | Poki | itch.io | GameDistribution (Azerion) |
|---|---|---|---|---|
| Submission | Self-serve upload via Developer Portal; human QA | Application form; curated; testing funnel inside P4D | Fully self-serve, instant | Self-serve account and upload; manual activation review (1-3 weeks) |
| SDK required | No for Basic Launch; yes for Full Launch | Yes (Poki SDK) | No | Yes, before upload (Terms 2.6.3) |
| Revenue share | Ad rev share, % not published | 100% on traffic you bring, 50% on Poki-brought traffic (exclusive deal) | Creator-set "open revenue sharing" (default 10% to itch) | Dev gets 33% of net ad and IAP revenue |
| Exclusivity | None required | Default deal is web-exclusive, 5 yrs (indicative); non-exclusive flat-fee option | None | Non-exclusive license, sublicensable to 2,000+ publisher sites |
| Own analytics | Allowed; needs a privacy/T&C notice if collecting personal data | Case-by-case approval; needs privacy policy | Yes, unrestricted | Prohibited |
| External links | Community links in menu only; **App Store links never allowed** | Only via `PokiSDK.openExternalLink()`; outgoing links removed by default | Yes | Prohibited without consent; SDK can block them |
| Fake-door purchase button | Risky. IAP is invite-only via Xsolla | Not allowed: "Remove in-game UI for buying currency or disabling ads" | Allowed | Not allowed (no IAP or tracking) |
| D1 retention to dev | **Yes**: dashboard shows D1, playtime, conversion during Basic Launch | Playtime histogram (Player Fit), CTR, conversion and playtime (Web Fit); no D1 documented | No (views, downloads, browser plays) | No player stats documented |
| Upload API | None documented | None documented | **Yes: `butler` CLI** | None documented |

## CrazyGames

- **Submission**: Developer Portal, "Submit a game". You need a web build, metadata, thumbnails and a cover/trailer. Two stages:
  - **Basic Launch**: no SDK needed, ads disabled, no revenue. The game is shown to a "small segment of players" for **7-21 days**, ending once it has been live 7 days and reached **500 plays** (or 21 days have passed). Rules: PEGI 12, basic visual QA, no external ads, no external login.
  - **Full Launch** (if selected): SDK required, with `gameplayStart`/`gameplayStop` events. The game must land players in gameplay immediately (max 1 click). Ads run through the SDK.
- **Basic Launch KPIs** (tracked automatically, dashboard refreshed daily, D1 one day later): average session playtime (good games reach 10+ min), **D1 retention (strong games 10-15%)**, conversion (share who play at least 1 min; top games 80%+), load time under 10 s, build size under 20 MB. Updates are approved automatically during Basic Launch.
- **SDK** (HTML5/Unity): ads (midgame and rewarded, frequency controlled by the SDK), gameplay events, a Data module (cloud save), a User module (CrazyGames account), and a system-info API. IAP is invite-only, through Xsolla using the CrazyGames Xsolla account.
- **Revenue share**: ad revenue share. The percentage is not published; payouts are covered in the T&C. Secondary sources cite 50-70% and a EUR 100 minimum via Tipalti (unverified).
- **Exclusivity**: none. The FAQ says you may publish elsewhere, including stores, as long as you hold the rights.
- **Technical**: initial download 50 MB or less (**20 MB or less to be eligible for the mobile homepage**); total 250 MB and 1,500 files max; relative paths only; time-to-gameplay 20 s or less if assets are hosted externally. Chrome/Edge are primary; the game is disabled on Safari if it runs poorly there. Mobile: touch input, safe areas, fullscreen inside the CrazyGames app, resume iOS audio on a user gesture, `user-select:none`. A sitelock must whitelist CrazyGames domains, including the app origins.
- **Ad rules**: no ads during active play; pause and mute only while an ad plays; continue normally on `adError`. Rewarded ads must be optional, marked with a video icon, have a coin alternative, and not appear on every death. At most 2 banners per screen, and never during gameplay. The game must stay playable with AdBlock on.
- **Own analytics / links**: no explicit ban on third-party analytics (ByteBrew is recommended). If you collect personal data beyond SDK events, show a T&C/privacy notice (a non-blocking notice is recommended). Links: Discord or dev-site links are OK in the menu if they don't lead to a playable web version. Steam/Epic links are allowed only for desktop games, on the menu or at the end of a demo. **"App Store links are never allowed in-game."** No cross-promotion. A waitlist/email link to our own site is likely acceptable as a "dev website" menu link, as long as it isn't the main CTA (needs confirmation).
- **Upload API**: none. Updates are manual uploads through the portal.

## Poki

- **Submission**: application form at developers.poki.com/guide/share. It asks for a playable build without login (or a video), screenshots, and team info. If accepted, the game goes through a five-stage funnel inside Poki for Developers (P4D): playtest recordings, then the **Player Fit Test** (500 Poki players, about 5 h, free, up to 2/day; pass bar is average playtime over 3 min with at least 25% of plays over 3 min; unlocked after watching 10 recordings), then the **Web Fit Test** (about 10,000 players on category pages over 3-5 days; measures CTR, average playtime, conversion to play), then final review, soft release, and global release. Uploads use "Upload New Version" in P4D and are tested in the Poki Inspector.
- **SDK**: required. It handles ads (`commercialBreak()`, `rewardedBreak()`; Poki controls frequency, so no internal ad timers) and `gameplayStart`/`gameplayStop` events, which feed Poki's metrics. External links go through `openExternalLink`.
- **Revenue and exclusivity**: the default deal is **web-exclusive** (the open web, including Discord and YouTube Playables) for **5 years ("indicative")**. App stores, Steam and consoles are not covered. You get 100% of revenue from players you bring and 50% from players Poki brings. Alternative: a **non-exclusive one-time flat license fee** with no rev share or marketing.
- **Technical**: desktop, mobile and tablet all required; 16:9 scaling (640x360 / 836x470 / 1031x580); **Poki blocks all external requests by default**, so bundle fonts and libraries; no splash screens or outgoing links; works with ad blockers and in incognito (wrap `localStorage` in try/catch); no numeric size cap in the official docs ("players leave if load > 10 s"). A secondary source cites an 8 MB initial-download target (unverified).
- **Monetization rules**: **no IAP**; "remove in-game UI for buying currency or disabling ads"; no third-party ads. The reward button must sit next to an equal-or-larger standard continue button, can't be green, and must show a 🎬 icon.
- **Own analytics**: GameAnalytics or in-house analytics are "reviewed case-by-case" and need a hosted privacy policy plus an in-game privacy UI. The FAQ says to consult Poki before adding any tracker.
- **Metrics to dev**: playtime histograms, CTR and conversion in the testing stages; the soft-release dashboard shows conversion, engagement, errors and monetization. **D1 retention is not documented as a developer-facing metric.**
- **Upload API**: none documented.

## itch.io

- **Submission**: self-serve, live immediately (public or restricted/unlisted). HTML5 is a zip with `index.html`.
- **SDK**: none. No ads are injected and no portal monetization exists. Revenue comes from optional pay-what-you-want or donations; creators set itch's share ("open revenue sharing", 10% by default).
- **Exclusivity**: none.
- **Technical**: 1,000 files or fewer, 500 MB extracted total, 200 MB per file, paths up to 240 characters, case-sensitive names. Cross-domain requests must be HTTPS; use relative paths. A "Mobile Friendly" flag forces click-to-fullscreen on mobile. The game runs in an iframe on an itch CDN domain.
- **Own analytics / links / fake doors**: no restrictions on outbound requests beyond HTTPS, so our own analytics, waitlist links and fake-door buttons are all technically possible. We must still disclose data collection in our own privacy notice.
- **Metrics**: page views, downloads/plays, purchases and referrers. **No retention.** Organic traffic is low unless the game is featured or ranks in "new and popular".
- **Upload API**: **`butler push <dir> user/game:channel --userversion X`**, authenticated with an API key (`BUTLER_API_KEY`). It does incremental patching and is designed for CI. The "playable in browser" setting is toggled once on the edit page after the first push.
- **Policy note**: in July-Aug 2025 itch deindexed NSFW content under payment-processor pressure. This doesn't affect casual games, but it shows the platform's policy can change quickly.

## GameDistribution (Azerion)

- **Submission**: create the game in the Developer Admin and complete the checklist. Verify the SDK by watching a test preroll (up to 2 weeks), then request activation; review takes 1-3 weeks. Updates are re-reviewed (up to 2 weeks).
- **SDK**: mandatory (`html5.api.gamedistribution.com/main.min.js`, `gdsdk.showAd()`, rewarded via `showAd('rewarded')`). It is built on Google IMA, emits GDPR consent events, and can block outgoing links.
- **Revenue**: **developer gets 33%** of net revenue (ads plus any GD-run IAP), with a EUR 100 minimum payout (Developer Terms, updated 2025-06-19). The game is sublicensed to GD's network of 2,000+ publisher websites.
- **Exclusivity**: non-exclusive license, but GD distributes your game anywhere in its network. Native app distribution through GD is excluded.
- **Restrictions (Terms 2.6.7 / 2.6.8)**: **no external links, no third-party ads, no IAP of our own, no data-tracking software**. The game must be hosted by GD (no iframing). Mobile is optional; if you tick "Mobile Ready", GD tests on old and new iOS/Android devices.
- **Metrics**: revenue reports only. No documented player or retention stats.
- **Upload API**: none documented.

## Recommendation

1. **CrazyGames Basic Launch is the primary retention/fun filter.** It needs no SDK, uploads are self-serve, 500+ real organic plays arrive in 7-21 days, and it is the only portal that hands back **D1 retention plus playtime and conversion** at no cost. It requires no exclusivity, so later app-store launches are unaffected. Constraint: no App Store links in-game and no external ads, so fake-door and waitlist tests must happen on our own site.
2. **itch.io is the instrumented companion and our own-site mirror.** It allows full automation (butler) and our own analytics, fake-door buttons and waitlist links. Its traffic is too small and too skewed toward developers to use as a retention signal, so treat it as a funnel and fake-door test bed, alongside our own site.
3. **Poki is an opportunistic upgrade, not a pipeline step.** Its Player Fit Test (500 players, playtime histogram) is an excellent fun filter, but entry is curated, there is no API, and the default deal is a 5-year web exclusive. Apply only for games that already pass CrazyGames.
4. **Skip GameDistribution for testing.** It has no player metrics, bans analytics and links, and pays 33%. Use it only as an end-of-life syndication channel for ad revenue.

## Implications for our design

- Build one HTML5 bundle with **portal adapters** behind a single interface (`ads`, `gameplayStart/Stop`, `analytics`, `externalLink`, `purchaseIntent`), compiled per target: `own-site`, `itch`, `crazygames-basic`, `crazygames-full`, `poki`, `gd`.
- **Size budget**: initial load under 20 MB (the CrazyGames mobile homepage limit); aim for under 8 MB to be Poki-ready. Fully self-contained, with no CDN fonts or libraries (Poki and GD block external requests).
- Fire `gameplayStart` on first input, not on load. Be ready for gameplay within 1 click. Keep it playable with ad blockers and in incognito (localStorage in try/catch). Support 16:9 responsive layout, touch and keyboard.
- **Feature flags per target**: fake-door purchase buttons, waitlist CTAs and App Store links are enabled **only** on own-site and itch builds. They must be compiled out of CrazyGames, Poki and GD builds.
- The pipeline reads CrazyGames dashboard KPIs (D1, playtime, conversion) as the go/no-go gate. There is no API, so plan a manual or scraped entry step. Mirror the same events into our own analytics on own-site/itch so the funnels are comparable.
- Use butler for automated itch deploys in CI. CrazyGames, Poki and GD uploads stay a manual human step (or browser automation, at the risk of breaching ToS).
- Ship a hosted privacy policy URL (not a Google Doc) and a non-blocking in-game privacy link in every build.
- Don't put a game on GD or other open-web portals if we may want a Poki exclusive later. Poki's non-exclusive option pays only a flat fee.

## Open questions

- CrazyGames: what is the actual rev-share %, and is there still an exclusivity bonus? Does a "join waitlist" link to our own site count as an allowed "dev website" link? Can we use our own analytics endpoint during Basic Launch (outbound requests aren't banned in the docs)?
- CrazyGames: is the Basic Launch audience geo-mixed? Can we get a geo split of D1 to compare with mobile tiers?
- Poki: does using the Player Fit Test, or merely being accepted, trigger exclusivity? Is a fit-test-only path possible for a game also on CrazyGames?
- Poki: is P4D still a closed beta in late 2026? Is the 8 MB initial-download target current?
- Does publishing an HTML5 version on portals hurt later app-store featuring, or trigger Apple 4.3 spam concerns for near-identical wrappers?
- Are CrazyGames' 500 plays per test enough to separate D1 of 10% from 15% reliably? Rough 95% CI at n=500 is ±3 pts, so it's borderline.

## Sources

- CrazyGames requirements intro: https://docs.crazygames.com/requirements/intro/
- CrazyGames technical requirements: https://docs.crazygames.com/requirements/technical
- CrazyGames gameplay requirements (links, cross-promo): https://docs.crazygames.com/requirements/gameplay/
- CrazyGames ad requirements: https://docs.crazygames.com/requirements/ads/
- CrazyGames Basic Launch metrics: https://docs.crazygames.com/resources/basic-launch-metrics/
- CrazyGames FAQ: https://docs.crazygames.com/faq/
- Poki deal types (exclusivity, rev share): https://developers.poki.com/guide/revenue-deal-types
- Poki requirements: https://developers.poki.com/guide/requirements-quality (redirect from sdk.poki.com/new-requirements)
- Poki Player Fit Test: https://developers.poki.com/guide/player-fit-test
- Poki Web Fit Test: https://sdk.poki.com/web-fit-test
- Poki P4D platform: https://developers.poki.com/guide/p4d-platform
- Poki submission form: https://developers.poki.com/guide/share
- Poki FAQ (external trackers): https://sdk.poki.com/faq
- Poki secondary summary (8 MB, funnel; dated July 2026): https://app.cinevva.com/guides/publish-game-poki
- itch.io HTML5 docs: https://itch.io/docs/creators/html5
- itch.io butler: https://itch.io/docs/butler/ and https://itch.io/docs/butler/pushing.html
- itch.io creator FAQ: https://itch.io/docs/creators/faq
- itch.io NSFW policy change (Aug 2025): https://gamingonlinux.com/2025/08/itch-io-to-reindex-free-adult-content-as-they-search-for-new-payment-processors
- GameDistribution developer terms (updated 2025-06-19): https://static.gamedistribution.com/terms/developer.html
- GameDistribution SDK: https://github.com/GameDistribution/GD-HTML5
- GameDistribution secondary summary (review times, analytics ban): https://portalready.world/portals/gamedistribution/
- Secondary note on missing portal upload APIs: https://playgama.com/blog/business-faqs/how-to-automate-web-game-uploads-using-portal-apis-and-cli-t/
