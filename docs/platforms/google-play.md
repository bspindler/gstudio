# Google Play: platform constraints for Studio in a Box

Researched 2026-10-25 from Google's official docs (developer.android.com, developers.google.com/android-publisher, support.google.com/googleplay/android-developer) plus the fastlane docs. Where a page showed a "last updated" date, it is noted. Claims sourced only from third parties are marked **(unofficial)**.

---

## 1. Google Play Developer API (Publishing / Edits / Monetization)

Base: `https://androidpublisher.googleapis.com/androidpublisher/v3`, OAuth scope `https://www.googleapis.com/auth/androidpublisher`.

**Auth (service account).** Create a GCP project, enable the Play Developer API, create a service account, then invite its email in Play Console > Users & permissions and grant it permissions (per app or globally). You no longer need to link the developer account to a GCP project. The service account can only do what its Play Console permissions allow.

**Edits workflow.** Call `edits.insert`, which snapshots the current state. Then upload bundles, set tracks, edit listings and images, and finally `edits.commit` (`edits.validate` is a dry run). Constraints:
- Each user can have only one open edit, and creating a new edit invalidates the old one.
- Any change made in the Play Console invalidates all open edits for that app. Never mix Console edits with an automated run in progress.
- Committed changes can take hours to show.
- **Prerequisite:** the app must already exist in Play Console, and "you will have to upload at least one APK through the Play Console before you can use this API." fastlane documents the same requirement.
- The API cannot publish/unpublish an app or complete the legal consents. Those happen in the Console.

**Bundles:** `edits.bundles.upload`. Internal app sharing is separate: `internalappsharingartifacts.uploadbundle`.

**Tracks:**
- Doc identifiers: `production`, `beta` (open), `alpha` (closed), and `"qa"` for internal (docs updated 2025-12-18). fastlane and the community use `internal`. See Open questions.
- Custom closed tracks use `[prefix]:$name`, and `edits.tracks.create` exists.
- Form-factor prefixes: `wear:`, `tv:`, `automotive:`, `android_xr:`, `google_play_games_pc:`.

**Staged rollout:**
- Set `status: inProgress` with `userFraction` (0 < f < 1).
- To increase, raise `userFraction`. To halt, set `halted`. To resume, set `inProgress`. To finish, set `completed`.
- A completed release can be halted only if there is an earlier completed fallback release.
- `inAppUpdatePriority` takes values 0-5 and cannot be changed after rollout.

**Country targeting:**
- `TrackRelease.countryTargeting` (`countries[]` plus `includeRestOfWorld`) "is only allowed to be set for inProgress releases in the production track", so it only works during a staged rollout.
- `edits.countryavailability` is **get-only**. Per-track country availability for testing tracks and the app-wide production country list could not be set through the API in the docs reviewed, which suggests it is Console-only.

**Listings & graphics:**
- `edits.listings` (per-locale title, short and full description), `edits.details` (contact email, default language), and `edits.images` (upload/delete/deleteall by imageType: icon, featureGraphic, phoneScreenshots, tablet, TV, wear, etc.).
- Testers: `edits.testers` (Google Groups for closed tracks).
- Store limits: title 30 characters, short description 80, full description 4,000.

**Monetization (no edits; takes effect immediately):**
- `inappproducts` is legacy but not marked deprecated for managed products. Subscriptions in it are deprecated.
- The newer `monetization.onetimeproducts`, with purchaseOptions and offers, adds batch methods.
- `monetization.subscriptions`, with basePlans and offers, plus `monetization.convertRegionPrices` for local pricing.
- Purchase verification: `purchases.productsv2` and `purchases.subscriptionsv2`. The v1 subscription cancel/defer methods are deprecated. Also `purchases.voidedpurchases` and `orders`.

**Other useful endpoints:**
- `reviews` (list/reply), `users` and `grants` (manage Console users through the API), `generatedapks.download`.
- **`applications.dataSafety`**: POST the Data safety CSV contents as a JSON string field (`safetyLabels`). Export a template from the Console first to get the format.

**Quotas:**
- Per-minute buckets with a default of 3,000 queries/min each. Publishing, Monetization, and Reply-to-Reviews share one bucket.
- Subscriptions, Subscription updates, One-time purchases, Orders, and ExternalTransactions are separate buckets.
- The quota page does not document a daily limit. Increases are requested through a form.

**Console-only (no API found in the v3 resource list):**
- Creating the app: Home > Create app. You set name, default language, app/game, free/paid, and contact email, and accept the policy, export law, and Play App Signing ToS declarations.
- The first bundle upload.
- The App content declarations:
  - content rating (IARC questionnaire)
  - target audience & content
  - ads declaration
  - app access
  - privacy policy URL (see Open questions)
  - government/financial/health declarations
  - Data safety, which can also be done through `applications.dataSafety` or CSV import
- Store category, tags, and pricing/country availability.
- The production access application after a closed test.
- Play Games Services project creation and linking. Achievements and leaderboards can be created through the Games Publishing API (section 6).

Sources:
- https://developers.google.com/android-publisher/api-ref/rest
- https://developers.google.com/android-publisher/edits
- https://developers.google.com/android-publisher/tracks
- https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks
- https://developers.google.com/android-publisher/api-ref/rest/v3/edits.countryavailability
- https://developers.google.com/android-publisher/api-ref/rest/v3/applications/dataSafety
- https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts
- https://developers.google.com/android-publisher/getting_started
- https://developers.google.com/android-publisher/quotas
- https://support.google.com/googleplay/android-developer/answer/9859152

---

## 2. Testing requirements & account types

**Closed test rule:**
- Applies to **personal accounts created after November 13, 2023**.
- You must run a closed test with **at least 12 testers opted in continuously for at least 14 days**. If a tester opts out and back in, their days must be consecutive.
- Production and Pre-registration stay disabled until you meet it. You then apply for production access in the Console.
- This applies **per app** (each new app goes through it).

**Organization accounts:**
- Google's official article scopes the rule explicitly to personal accounts. No official page states that organization accounts must comply, and none states an explicit exemption either.
- Third-party guides uniformly report that organizations are exempt **(unofficial)**. Treat it as "very likely exempt", not as a documented guarantee.
- Also unofficial: the rule was originally 20 testers, and dropping below 12 restarts the clock.

**Account basics:**
- **Fee:** US$25 one-time registration fee, paid by card. Prepaid cards are not accepted.
- **Same features:** personal and organization accounts have the same functionality and can both monetize.
- **Organization requirements:**
  - An organization account requires a **D-U-N-S number**. It is free from Dun & Bradstreet and can take up to 30 days to obtain.
  - It also needs an organization name and address matching D&B, an org phone, and a website.
  - Some app types require an organization account (financial, health, VPN, government).
- **Verification:**
  - Legal name and address must be verified before publishing.
  - Contact email and phone are verified by OTP.
  - The payment profile is verified if you sell.
  - New personal accounts (since early 2024) must also verify access to an Android device through the Play Console mobile app.
- **Android developer verification (all Android apps):**
  - Rollout: APIs launch August 2026, enforcement begins 2026-09-30 in BR/ID/SG/TH, and it goes global in 2027+.
  - Google Play automatically registers about 99% of Play apps, so Play-only developers mostly need no action.

Sources:
- https://support.google.com/googleplay/android-developer/answer/14151465
- https://support.google.com/googleplay/android-developer/answer/13634885
- https://support.google.com/googleplay/android-developer/answer/13628312
- https://support.google.com/googleplay/android-developer/answer/6112435
- https://developer.android.com/developer-verification

---

## 3. Policies

**Families / target audience:**
- Every app declares target age groups in App content > Target audience and content before publishing. Google may review the declaration, and misrepresenting it can lead to removal.
- If **any** child age group is included, the Families policy applies:
  - Content must be appropriate for children.
  - The app must not "merely provide a webview of a website."
  - Child-only apps must not transmit the AAID or other persistent identifiers, and must not request location or the phone number.
  - Only SDKs approved for child-directed services may be used. Mixed-audience apps need a neutral age screen.
- **Ads to children or users of unknown age:**
  - Use only Families **self-certified ads SDKs**.
  - No personalized ads or remarketing, and no interstitials on launch.
  - Rewarded/opt-in ads must be closeable after 5 seconds.
  - No gambling, alcohol, dating, or similar ad categories.
- The Self-Certified Ads SDK program page says it is **not accepting new applicants**, so the list is fixed. Teacher Approved is opt-in and not guaranteed.

**Loot boxes:** games that sell randomized virtual items must "clearly disclose the odds of receiving those items in advance of" purchase, close to the point of purchase. In-app digital goods (currencies, extra lives, add-ons) must use Google Play Billing.

**Spam / repetitive content:**
- Not allowed: "Creating multiple apps with highly similar functionality, content, and user experience."
- Also not allowed: "apps that merely provide the same experience as other apps already on Google Play."
- Google suggests that when each app has little content, you consider "creating a single app that aggregates all the content."
- Minimum functionality: apps must be "stable, functional, and provide meaningful content." No crashes, freezes, or "designed to do nothing" apps.

**WebView concerns:**
- **Webview spam:** this rule targets apps whose primary purpose is a webview of a **website** without the owner's permission. A bundled local HTML5 game in Capacitor is not that case.
- **Device & Network Abuse:** an app "may not download executable code (such as dex, JAR, .so files) from a source other than Google Play". The rule excludes code running in "a virtual machine or an interpreter ... (such as JavaScript in a webview or browser)".
- Also a violation: "a webview with added JavaScript Interface that loads untrusted web content." Capacitor's native bridge must therefore only load our own bundled or trusted content, never arbitrary remote URLs.

Sources:
- https://support.google.com/googleplay/android-developer/answer/9893335 (Families)
- https://support.google.com/googleplay/android-developer/answer/9867159 (Target audience / app content)
- https://support.google.com/googleplay/android-developer/answer/9900633 (Families ads)
- https://support.google.com/googleplay/android-developer/answer/9858738 (Monetization: loot boxes, billing)
- https://support.google.com/googleplay/android-developer/answer/9899034 (Spam)
- https://support.google.com/googleplay/android-developer/answer/9898783 (Functionality)
- https://support.google.com/googleplay/android-developer/answer/9888379 (Device & Network Abuse)

---

## 4. Data safety, target API, Play Integrity, Billing Library

**Data safety:**
- Required for every app on closed, open, or production tracks. Internal-only apps are exempt.
- It is required even when the app collects no data, and a privacy policy link is needed too.
- You must declare data collected by SDKs, using the SDK Index and vendor guidance.
- Ways to submit: the Console form, CSV import (which overwrites), or the `applications.dataSafety` API.
- Review/propagation can take up to 7 days. Inaccurate forms lead to blocked updates or removal.

**Target API (page updated 2026-10-16):**
- Since **2026-08-31**, new apps and updates must target **API 36 (Android 16)**. Wear/Automotive must target 35, and TV/XR 34.
- The extension deadline was **2026-11-01**, which is in about a week.
- Existing apps must target ≥35 to stay visible to new users on newer devices.

**Play Billing Library:**
- Deprecation table: PBL 7 must be gone by 2026-08-31 (extension 2026-11-01), so **new apps/updates now need PBL 8+**.
- PBL 8 is supported until 2027-08-31 and PBL 9 until 2028-08-31.
- Choose a Capacitor IAP plugin that ships PBL 8 or 9.

**Play Integrity:**
- Verdicts: `appRecognitionVerdict` (PLAY_RECOGNIZED), `appLicensingVerdict` (LICENSED), and `deviceIntegrity` labels (STRONG/DEVICE/BASIC, opt-in).
- Optional signals: app access risk, Play Protect, recent device activity, and deviceRecall (beta).
- Prefer Standard requests (warm-up, then about 100s of ms) over Classic.
- **Default quota is 10,000 requests/day per app**, and you can request an increase.
- It requires Play distribution and a server to decrypt and verify tokens. It is not needed unless we have leaderboards or economies worth protecting.

Sources:
- https://support.google.com/googleplay/android-developer/answer/10787469
- https://developer.android.com/google/play/requirements/target-sdk
- https://developer.android.com/google/play/billing/deprecation-faq
- https://developer.android.com/google/play/integrity/overview

---

## 5. Data pull (reporting)

**Play Developer Reporting API** (`playdeveloperreporting.googleapis.com`, v1beta1):
- Vitals: `crashrate`, `anrrate`, `slowstartrate`, `slowrenderingrate`, `excessivewakeuprate`, `stuckbackgroundwakelockrate`, `lmkrate`, and memory metrics.
- Errors: `errors.counts`, `errors.issues.search`, `errors.reports.search` (stack traces).
- Also `anomalies.list` and `apps.search`.
- It has **no installs or ratings**.

**Ratings and reviews text:**
- Androidpublisher `reviews.list` returns recent reviews only. The 7-day limitation is common knowledge but was not verified on the page.
- The `reviews/` CSV export (below) has the full history.

**Bulk/financial exports to Cloud Storage:**
- Bucket: `gs://pubsite_prod_rev_<id>`, copied from Download reports > "Copy Cloud Storage URI".
- Read it with a service account invited in Play Console and the `devstorage.read_only` scope. You need "View app information" (Global) for stats and "View financial data" (Global) for earnings/sales.
- Files:
  - `stats/installs/installs_<pkg>_YYYYMM_<dimension>.csv`
  - `stats/ratings/...`
  - `stats/crashes/...`
  - `reviews/reviews_<pkg>_YYYYMM.csv`
  - `sales/salesreport_YYYYMM.zip` (estimated, low latency)
  - `earnings/earnings_YYYYMM.zip`
- Stats files are monthly files updated daily, landing within 3-7 days. Earnings arrive monthly, by around the 5th.
- CSVs are **UTF-16**. Convert them before BigQuery or pandas.
- Detailed crash/ANR CSVs are discontinued, so use the Reporting API.
- From October 2026, earnings Fee Description adds the values `APPS_GAMES_PROGRAM` and `APPS_GAMES_PROGRAM_NEW_INSTALL`.

Sources:
- https://developers.google.com/play/developer/reporting
- https://developers.google.com/play/developer/reporting/reference/rest
- https://support.google.com/googleplay/android-developer/answer/6135870

---

## 6. Play Games Services v2

**Setup:**
- Create a Game services project in Play Console and link it to the app and a GCP project. This requires an OAuth client tied to the signing SHA-1; see the setup guide.
- Add the `com.google.android.gms.games.APP_ID` meta-data (the project ID string) to the manifest.
- Dependency: `com.google.android.gms:play-services-games-v2` (≥21.0.0 for profile-suppression).
- Call `PlayGamesSdk.initialize(this)` in `Application.onCreate`.

**Sign-in:**
- Automatic at launch. Check it with `GamesSignInClient.isAuthenticated()`, and fall back to a manual `signIn()` button.
- Don't trust the client player ID on your backend. Use server auth code access instead.
- PGS is the platform identity only, not save data or inventory.

**Leaderboards:**
- Up to **70 per game**. Daily/weekly/all-time variants are automatic, resetting at midnight PDT (UTC-7).
- Scores are longs. Formats: numeric, time (ms), or currency (micro-units). Ordering is fixed once published.
- Tamper protection is on by default for new boards.
- Submit with `LeaderboardsClient.submitScore`, and show the built-in UI.

**Automation:** the **Games Publishing API** can create and edit achievements and leaderboards and upload their icons, which allows scripted config. Creating the game services project itself does not appear to be API-able.

**Deprecation:**
- PGS v1 SDK (`play-services-games` v24) was deprecated 2025-09-12, and new titles on v1 are blocked from publishing.
- `play-services-games:25.0.0` (2026-06-15) removes the v1 APIs.
- Legacy Google Sign-In removal is happening around September 2026.
- v1 shuts down around May/June 2027 (the page is inconsistent on the exact month).
- **Only use v2.**

**Capacitor:**
- A plugin needs native bridging for `isAuthenticated`, `signIn`, `submitScore`, `showLeaderboard`, plus the manifest meta-data.
- Check that a plugin targets `play-services-games-v2`, not v1 or GoogleSignIn. Many older community plugins use the removed v1 APIs.

Sources:
- https://developer.android.com/games/pgs/overview (updated 2026-10-06)
- https://developer.android.com/games/pgs/android/android-signin
- https://developer.android.com/games/pgs/leaderboards
- https://developer.android.com/games/pgs/publishing/publishing
- https://developer.android.com/games/pgs/deprecation

---

## 7. fastlane supply (`upload_to_play_store`)

**What it supports:**
- Uploads AAB/APK to production, beta, alpha, internal, or custom tracks.
- Staged rollout (`rollout`), `track_promote_to`, `release_status` (e.g. draft), and `in_app_update_priority`.
- Per-locale metadata, changelogs (`changelogs/<versionCode>.txt`), and screenshots/graphics. Screenshot uploads replace the existing set. Also `validate_only` and mapping uploads.
- Auth: JSON service-account key (`json_key` / `json_key_data`) or Workload Identity Federation.

**Limits:**
- It requires the app to exist and **at least one build uploaded manually** first.
- It does not cover in-app products, country availability, Data safety, or content rating.

It is fine for the release step, but call the raw API directly for monetization, data safety, and reviews.

Source: https://docs.fastlane.tools/actions/upload_to_play_store/

---

## Implications for our design

- **Per-game manual bootstrap is unavoidable.** Each game needs a human Console session:
  - create the app
  - accept declarations
  - upload the first AAB
  - fill content rating, target audience, ads, and app access
  - set up a Game services project if used
  - choose countries and pricing

  Design this as a checklist "gate" in the pipeline, then automate everything after it through the API.
- **Use an organization account (D-U-N-S).** It almost certainly avoids the 12-testers/14-days gate on **every** new app. That gate would otherwise add about 2+ weeks and a tester pool per game. Budget about 30 days to obtain the D-U-N-S number.
- **The repetitive-content policy is the biggest strategic risk.** Many near-identical small games from one account can trigger "multiple apps with highly similar functionality" enforcement, and account-level strikes are possible. Mitigations:
  - make sure each game has a distinct core mechanic, art, and content
  - avoid reskin batches
  - or consider bundling small games into a collection app, as Google suggests
- **Default target audience: 13+ (or 18+), not children.** Any child age group pulls in Families rules: limited ad SDKs (the self-cert list is closed), no AAID, no personalized ads, and a ban on webview-of-website. Also avoid kid-appealing store art, which could prompt a Google re-classification.
- **Capacitor/WebView is OK if the game is bundled locally.** Do not load remote URLs into the bridge (JS-interface + untrusted content is a violation). Remote JS live updates are allowed under the interpreter exception. Native code must ship through Play.
- **Pin build baselines:** targetSdk 36, PBL 8+ (or 9) in any IAP plugin, and PGS v2 only. Plan on a yearly August-31 bump (targetSdk +1, PBL +1).
- **Automate Data safety** with the `applications.dataSafety` CSV endpoint from a per-game template generated from our SDK list. Keep the SDK set small and identical across games.
- **Never touch the Console during an automated edit**, because that invalidates it. Run one edit per app at a time.
- **Country targeting via API** only exists for production staged rollouts. Set the base country list once in the Console.
- **Analytics ingestion:** a nightly GCS sync of `stats/` and `earnings/` (UTF-16 to UTF-8), the Reporting API for crash/ANR and error clusters, and `reviews.list` for fresh reviews. Expect 3-7 day lag on installs.
- **Leaderboards/achievements can be scripted** with the Games Publishing API (70 board cap). The PGS project itself is a manual step.
- **Loot boxes:** if any game sells randomized items, show the odds in-UI before purchase.

## Open questions / couldn't verify

- **Org-account exemption from the 12/14 rule:** strongly implied (the official text says "personal accounts"), but no official page says "organizations are exempt". Confirm in Console on the actual org account.
- **Internal track identifier:** the docs say `"qa"`, while fastlane and the community use `internal`. Test both against the API.
- **App-level country/pricing and testing-track availability:** no write endpoint found (countryavailability is get-only). Assume Console-only.
- **Content rating, target audience, ads declaration, privacy policy URL:** no API found in the v3 resource list. `appstoreappsreview` appeared in sidebar navigation only and was not inspected.
- **Daily/edit-commit quotas:** not documented on the quotas page, which lists only 3,000/min per bucket.
- **Play Integrity cost** beyond the 10k/day default, and behavior when called from a Capacitor plugin: not stated.
- **PGS v1 shutdown month:** the deprecation page says both May and June 2027.
- **Billing deprecation page:** it has a banner plus a table. Read together, they mean PBL 8+ is required as of 2026-08-31. Verify in the Console warnings on first upload.
- **`reviews.list` time window:** not verified.
- **Whether the "repetitive content" enforcement threshold** has any numeric guidance: none was found. It is judgment-based.
