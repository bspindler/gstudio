# Apple platform constraints (iOS / App Store)

Researched 2026-10-25 from Apple's official docs (developer.apple.com, App Store Review Guidelines last updated **2026-10-16**), the App Store Connect API OpenAPI spec **v4.5.1**, and docs.fastlane.tools / fastlane releases. Apple doc pages were read through their JSON doc endpoints and the published OpenAPI spec. Unless a date is given, a fact is current as of the research date.

---

## 1. App Store Connect API (ASC API)

Sources: https://developer.apple.com/documentation/appstoreconnectapi · release notes https://developer.apple.com/documentation/appstoreconnectapi/app-store-connect-api-release-notes · OpenAPI spec https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip (v4.5.1, 1,001 paths)

### Auth
- JWT signed **ES256** with a private key (.p8) from App Store Connect > Users and Access > Integrations. Header: `alg`, `kid`, `typ`. Payload: `iss` (issuer ID), `iat`, `exp`, `aud: appstoreconnect-v1`, optional `scope`. https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests
- Token lifetime can be **at most 20 min**. The exception is GET-only scoped tokens on a short list of resources (mostly Xcode Cloud and perf metrics), which can last up to 6 months. Reuse a token until it expires.
- **Team keys** cover all apps and take a role (Admin, App Manager, and so on), and only an Admin can create them. **Individual keys** carry one user's permissions and **can't use Provisioning, Sales & Finance, or notarytool**. The private key can be downloaded once. https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api
- Analytics reports need the Admin role (to create requests) or Sales and Reports / Finance (to read). The `ACCESS_TO_REPORTS` key permission is deprecated (4.3/4.4).

### Rate limits
- Limits are counted **per API key** over a rolling hour. Each response carries the header `X-Rate-Limit: user-hour-lim:3500;user-hour-rem:500;`. 3,500/hr is Apple's example, and Apple says "actual limits can vary". Going over returns HTTP 429 `RATE_LIMIT_EXCEEDED`, so queue and retry. https://developer.apple.com/documentation/appstoreconnectapi/identifying-rate-limits
- One way to spread load is multiple team keys. Treat this as an inference: Apple says limits are per key.

### What can be automated (verified against spec v4.5.1)
| Capability | API | Notes |
|---|---|---|
| **Create the app record** | **NO** | `/v1/apps` is GET/PATCH only. Docs: "Don't use this API to create new apps; instead, create new apps on the App Store Connect website." |
| Bundle IDs, capabilities, certs, profiles, devices | Yes | `POST /v1/bundleIds` and related. Needs a team key. |
| Build upload | Yes (new in 4.1) | `POST /v1/buildUploads` + `buildUploadFiles` reserve/commit. Webhook `BUILD_UPLOAD_STATE_UPDATED`. Xcode, Transporter, and altool also work with API keys. The Apps doc page still says the API "doesn't permit you to directly upload", which is outdated text that conflicts with 4.1. |
| Export compliance | Yes | `appEncryptionDeclarations`, or set `ITSAppUsesNonExemptEncryption` in Info.plist. |
| TestFlight groups/testers | Yes | `betaGroups` (create, add builds and testers), `betaTesters`, `betaTesterInvitations`, `betaRecruitmentCriteria`, tester usage metrics, feedback screenshots and crashes (4.0). |
| TestFlight public links | Yes | `betaGroups` attributes `publicLinkEnabled`, `publicLinkLimitEnabled`, `publicLinkLimit` (1–10,000), and `publicLink` (read). External groups only. |
| External beta review | Yes | `POST /v1/betaAppReviewSubmissions` + `betaAppReviewDetails` (contact, demo account, notes) + `betaAppLocalizations` / `betaBuildLocalizations` ("What to Test"). |
| Version metadata | Yes | `appStoreVersions`, `appStoreVersionLocalizations` (description, keywords, promo text, what's new, URLs), `appInfoLocalizations` (name, subtitle, privacy policy URL), categories, `appStoreReviewDetails` and attachments. |
| Age rating questionnaire | Yes | `PATCH /v1/ageRatingDeclarations/{id}`, read via `appInfos/{id}/ageRatingDeclaration`, plus per-territory `territoryAgeRatings` (4.1). Values have changed often (see §4). |
| Screenshots / app previews | Yes, **but migrating** | 4.5.1 **deprecates** `appScreenshotSets`, `appScreenshots`, `appPreviewSets`, and `appPreviews` (they still exist in the spec). The replacement is the **App Asset Library**: `appAssetLibraryImages`/`Videos` + `appAssetLibraryPlacements` + `appAssetLibraryRefData` (read specs and dimensions rather than hard-coding them; new `IPHONE_DUO` display class). |
| Custom product pages, PPO experiments, in-app events | Yes | |
| IAP creation and pricing | Yes | `POST /v2/inAppPurchases`, localizations, `inAppPurchasePriceSchedules`, `inAppPurchaseAvailabilities`, images, review screenshot, `inAppPurchaseSubmissions`. New in recent versions: IAP **versions** (`inAppPurchaseVersions`) and v2 localization/image resources, which means a migration ("Migrating In-App Purchase metadata to v2"). Offer codes for consumables and non-consumables (4.2). Subscriptions and groups as well. |
| App price | Yes | `POST /v1/appPriceSchedules`, price points and equalizations (v3 price points). |
| Territory availability | Yes | `POST /v2/appAvailabilities` with `territoryAvailabilities` (the doc labels it "Create an app pre-order", but it sets per-territory availability), then `PATCH /v1/territoryAvailabilities/{id}`. |
| Submit for review | Yes | `reviewSubmissions` + `reviewSubmissionItems`. The old `appStoreVersionSubmissions` create was removed in 4.0. Game Center items can be submitted on their own (4.2). |
| Phased release | Yes | `appStoreVersionPhasedReleases` (create/pause/resume/cancel). **Not available for an app's first version.** Manual release uses `appStoreVersionReleaseRequests`. |
| Game Center config | Yes | v2 leaderboards/achievements with versioning (v1 POST deprecated), activities, challenges, score moderation (4.5). |
| Customer reviews + responses | Yes | |
| Sales/finance reports | Yes | `GET /v1/salesReports`, `/v1/financeReports` (gzip TSV). **Team key required.** |
| Analytics reports | Yes | `analyticsReportRequests` → reports → instances → segments (downloads). The data has noise/crowd-anonymity applied. IAP and subscription data were added to Analytics on 2026-03-25. |
| Perf/power metrics | Yes | Including `performanceOverviews` (4.5). |
| Webhooks | Yes (4.0+) | App version state, TestFlight feedback, build upload, build beta detail events. Lets the pipeline react to events rather than poll. |
| Users/sandbox testers | Yes | |

### Still web-UI-only (or not found in the spec)
- **Creating the app record.** The app name has to be reserved by a human on the website, once per game.
- **App Privacy "nutrition label" answers.** There are no privacy/data-usage endpoints in spec v4.5.1. fastlane's `upload_app_privacy_details_to_app_store` uses an Apple ID web session, not the API (see §6).
- Agreements, tax, and banking (Paid Apps agreement); DSA trader status (EU). These are account-level, one-time tasks.
- Enabling App Store Server Notifications URLs. The docs say to set this in App Store Connect. Not verified whether the API supports it.
- Creating the API keys themselves, and the App Store Connect "preview tool" for creative assets (2026-10).

---

## 2. TestFlight

Sources: https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview · https://developer.apple.com/documentation/appstoreconnectapi/beta-groups · https://developer.apple.com/documentation/appstoreconnectapi/betagroup/attributes-data.dictionary

- **Internal testers:** up to **100** App Store Connect team members. No beta review.
- **External testers:** up to **10,000** per app, invited by email or **public link**.
- **Public link:** set per external group. An optional tester cap of **1–10,000** (`publicLinkLimit`), plus optional recruitment criteria (device/OS filters, `betaRecruitmentCriteria`).
- **Beta App Review:** required for external testing. It is "required only for the first build added to a group. Subsequent builds may not need a full review." The build is checked against the App Review Guidelines. You must supply beta review details (contact, notes, demo account).
- **Build expiry:** **90 days** after upload. You can expire a build manually earlier.
- Builds need the right app identifiers in their provisioning profile. Managed Apple Accounts in reserved domains can't test.
- No official SLA for beta review timing was found.

---

## 3. App Review

Sources: https://developer.apple.com/app-store/review/guidelines/ (last updated 2026-10-16) · https://developer.apple.com/distribute/app-review/ · news https://developer.apple.com/news/

### Timelines
- Apple's published numbers: "typically reviewing at least **50% of submissions in less than 24 hours and 90% in less than 48 hours**." Incomplete submissions are delayed. Repeated rejections for the same guideline, or attempts to manipulate review, make reviews slower.
- **Expedited review** is for critical bug fixes (include repro steps) or event-tied releases.
- **Appeals** go to the App Review Board, one per rejected submission.
- **Bug-fix submissions** for apps already live are not held up over guideline violations, unless the violation is legal or safety related.

### Key guidelines (quoted or closely paraphrased)
- **4.2 Minimum Functionality:** "Your app should include features, content, and UI that elevate it beyond a repackaged website. If your app is not particularly useful, unique, or 'app-like,' it doesn't belong on the App Store. If your App doesn't provide some sort of lasting entertainment value or adequate utility, it may not be accepted."
  - 4.2.2: not "primarily marketing materials, advertisements, web clippings, content aggregators, or a collection of links."
  - 4.2.3(ii): if the app downloads extra resources at first launch, disclose the size and prompt the user first.
  - **4.2.6:** "Apps created from a commercialized template or app generation service will be rejected unless they are submitted directly by the provider of the app's content." Template providers may instead ship a single "picker" binary.
- **4.3 Spam:**
  - (a) "Don't create multiple Bundle IDs of the same app… If your app has different versions for specific locations, sports teams, universities, etc., consider submitting a single app and providing the variations using in-app purchase."
  - (b) "Don't submit apps that are indistinguishable from what's already widely available. Opportunistically creating variants of existing app categories or popular apps degrades App Store discovery…" Saturated categories are named (flashlight, sound effects, wallpaper, simple timers, fortune telling…). Low-effort types are named (drinking games, fart/burp apps). "**Repeated submissions of this kind may lead to removal from the Apple Developer Program.**"
- **4.1 Copycats:** don't clone popular apps or make minor UI/name changes to them. Impersonation violates the Code of Conduct. No other developer's brand in your icon or name.
- **2.5.2:** "Apps should be self-contained in their bundles… nor may they download, install, or execute code which introduces or changes features or functionality of the app." This forbids remote-loading new game code or features into a Capacitor shell. Educational coding apps are the only exception.
- **2.5.6:** apps that browse the web must use WebKit. Capacitor's WKWebView complies.
- **2.5.19 (NEW 2026-10-16):** "Don't include any hidden, dormant, or undocumented features… Attempting to hide undocumented features in your app binary, such as through code obfuscation or other methods, is grounds for removal… and termination of your developer account." This targets bait-and-switch, so remote feature flags that unlock unreviewed features are risky.
- **4.7 Mini apps / mini games:** HTML5/JS mini games that are *not embedded in the binary* are allowed only inside a host app that takes full responsibility. Requirements: content filtering, reporting, and blocking (4.7.1); no exposing native APIs without Apple permission (4.7.2); an index with universal links to every item (4.7.4); age-gating for items above the app's rating (4.7.5); IAP under 3.1.
- **3.1.1 IAP:** digital unlocks (levels, currencies, full version, premium) **must use IAP**. Credits and in-game currency bought through IAP "may not expire". Provide a restore mechanism. **Loot boxes:** "Apps offering 'loot boxes' or other mechanisms that provide randomized virtual items for purchase must disclose the odds of receiving each type of item to customers prior to purchase." 3.1.1(a) (external purchase link entitlements) was clarified on 2026-10-16. The US storefront has its own rules on external links and buttons (2025-05-01 update).
- **3.2.2(iii):** no apps "designed predominantly for the display of ads". **3.2.2(x):** you may reward in-app actions (watch an ad, complete a level), but you may not force ratings or reviews.
- **1.3 Kids Category:** no links out, purchases, or "distractions" unless behind a parental gate. No sending PII or device info to third parties. "Should not include third-party analytics or third-party advertising". There are limited exceptions for analytics that never collect the IDFA or identifiable child data, and for ads under the same terms (5.1.4). Once an app is in the category, later updates must keep complying even if you leave it.
- **2.3.7:** app name **≤30 chars**. No keyword stuffing with trademarks, competitor names, or prices. **2.3.8:** metadata must suit 4+. "For Kids/For Children" is reserved for the Kids Category. **2.3.14 (new 2026-10):** creative assets (product page header, search result asset) must relate to the app and contain no pricing.
- **5.6.3/5.6.4:** chart or review manipulation is banned. "Excessive customer reports… negative customer reviews, and excessive refund requests" count against the developer's standing under the Code of Conduct.

### Web-wrapper concerns for Capacitor games
- Apple has no rule against a WKWebView game whose HTML/JS **ships inside the bundle**. The risks are 4.2 ("repackaged website", not "app-like") and 2.5.2 (remote code).
- **Do:** bundle all game assets. Work offline. Use native touches such as haptics, Game Center, IAP via StoreKit, and safe areas. Have no browser chrome or external links as primary UI, and no loading screen that fetches the game from a URL.
- **Don't:** load the game from a remote URL, hot-swap gameplay JS (OTA "live update" plugins that change features run into 2.5.2/2.5.19), or ship "a website in a box."

### Practical advice: many small games without tripping 4.3 / 4.2.6
- Each game must differ in **mechanics**, not just in theme, skin, or level pack. Reskins of one engine are the textbook 4.3(a) case. Apple's suggested remedy is one app with variations via IAP.
- Avoid the saturated and low-effort categories named in 4.3(b).
- Every app should have its own name, icon, screenshots, and description. Avoid near-duplicate metadata across apps; a templated look in the listings is a red flag (this is an inference from 4.3 and 4.2.6 wording).
- Submit **from our own developer account as the content owner**. 4.2.6 bans submitting template- or generator-made apps on behalf of others.
- Give each game "lasting entertainment value" (progression, scores, Game Center leaderboards) to clear 4.2.
- Pace submissions, and stop and rework after any 4.3 rejection. "Repeated submissions… may lead to removal from the Apple Developer Program" puts the **whole account** at risk, not just one app.
- Alternative architecture: a single "arcade" host app that bundles many mini-games (embedded in the binary) avoids 4.3(a). If mini-games are downloaded rather than bundled, 4.7's requirements (index, universal links, moderation) apply.

---

## 4. Privacy & age rating

Sources: https://developer.apple.com/app-store/app-privacy-details/ · https://developer.apple.com/documentation/apptrackingtransparency · https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api · https://developer.apple.com/support/third-party-SDK-requirements/ · https://developer.apple.com/news/upcoming-requirements/ · https://developer.apple.com/news/

- **Privacy nutrition labels:** required for every new app and update. They cover data collected by you **and by third-party SDKs** (ads, analytics). They are entered in App Store Connect by the Account Holder, Admin, or App Manager, and can be updated without a new build. **No ASC API endpoint** exists. "Tracking" means linking app data with third-party data for targeted ads or ad measurement, or sharing it with data brokers. A data type can be left out only if it meets *all* of the optional-disclosure criteria.
- **ATT:** required before tracking or reading the IDFA. Needs the `NSUserTrackingUsageDescription` purpose string and `ATTrackingManager.requestTrackingAuthorization`. Newer API: `requestTrackingAuthorization(preferExpandedInterface:additionalInformationAction:)` and `NSUserTrackingMarkdownUsageDescription`. **EU (news 2026-09-16):** from iOS/iPadOS 27.2 developers may use an alternative ATT prompt in the EU. In **Germany, France, Italy, Poland, and Romania only the alternative prompt** is available. When permission is needed is unchanged.
- **Privacy manifests / required-reason APIs:** since **2024-05-01**, uploads that use required-reason APIs (e.g., UserDefaults, file timestamps, system boot time, disk space) without declared reasons in `PrivacyInfo.xcprivacy` (`NSPrivacyAccessedAPITypes`) are **rejected by App Store Connect**. Every executable or dynamic library (framework) that uses them needs its own manifest. Fingerprinting is banned regardless of ATT. Note that the WebKit/JS layer is not covered, but Capacitor's native code and plugins are.
- **SDK signatures:** SDKs on Apple's "commonly used third-party SDKs" list need a privacy manifest when a new app or update adds them, and a **signature** when they're used as a binary dependency. **Capacitor and Cordova are on the list by name**, as are many Firebase modules. Google Mobile Ads, AppLovin, and Unity Ads are not listed by name.
- **Age ratings (big 2025–2026 changes):**
  - 2025-07-24: new tiers **4+, 9+, 13+, 16+, 18+** (12+/17+ replaced). New required questions cover in-app controls, capabilities, medical/wellness, and violent themes. AI chatbot content counts. You may choose a higher rating. **Answers were due 2026-01-31** or updates get blocked.
  - 2026-05-21: Australia and Vietnam got region-specific ratings (Vietnam 00+). 2026-08-12: Korea-specific ratings (API `koreaAgeRatingOverride` ALL / TWELVE_PLUS, 4.5).
  - 2026-07-09: **social media questions** added (feeds or discovery of UGC). These drive the new "Time Allowances" (iOS 27) categories for Games, Entertainment, and Social. **Required from September 2026** for new apps and updates.
  - Age-assurance laws: Texas SB 2420 has been in effect for new Texas accounts since **2026-06-04** (parental consent for downloads, IAP, and "significant changes"). Similar requirements exist in Brazil, Australia, Singapore, Utah, and Louisiana (news 2026-02-24). Tools: **Declared Age Range API**, PermissionKit Significant Change API, a consent-revocation server notification, and the StoreKit `ageRatingCode`.
- **Other upload gates:** must be built with **Xcode 26 / iOS 26 SDK** (since 2026-04-28) and target **iOS 13+** (since 2026-09-09). **From April 2027:** iOS 27 SDK required, and **iPhone Duo screenshots required** for all submissions (news 2026-02-03 and 2026-10-05). EU distribution requires DSA trader status.

---

## 5. StoreKit 2, server notifications, receipts, Game Center

Sources: https://developer.apple.com/documentation/storekit/in-app-purchase · https://developer.apple.com/documentation/storekit/skpaymentqueue · https://developer.apple.com/documentation/appstoreservernotifications · https://developer.apple.com/documentation/appstoreserverapi · https://developer.apple.com/documentation/appstorereceipts · https://developer.apple.com/documentation/gamekit

- **StoreKit 2** (Swift, async: `Product`, `Transaction`, `AppTransaction`) is the current API. The original StoreKit API (`SKPaymentQueue` etc.) is **marked deprecated since iOS 18** ("No longer supported"). New features need StoreKit 2: iOS 27 subscription "Bundles and Suites" (news 2026-09-16), offer codes for consumables, and similar.
  - **For our Capacitor IAP plugin, pick one built on StoreKit 2.** Many older Cordova/Capacitor plugins wrap StoreKit 1; check each one.
- Transactions are JWS-signed (RFC 7515). Verify them on device or on the server.
- **Receipts:** the `verifyReceipt` endpoint is **deprecated**. Use App Store Server API / `Transaction` / `AppTransaction`. The SHA-1 receipt intermediate certificate expired on 2025-01-24, so on-device receipt validation must use SHA-256.
- **App Store Server Notifications:** **use V2 only** (V1 is deprecated). Set the HTTPS URL in App Store Connect for production and sandbox. Events cover purchases, renewals, refunds, offer redemptions, and `CONSUMPTION_REQUEST` (refund consumption info), plus the age-consent revocation notification described above.
- **App Store Server API:** transaction info and history, subscription statuses, refund history, Send Consumption Info, notification history (**180 days** prod / 30 days sandbox), test notifications, renewal extensions, order-ID lookup.
- For consumable-only games with no accounts, a server is optional. A server is needed for refund handling and anti-fraud on currency.
- **Game Center:** enable the Game Center capability and entitlement and configure it in App Store Connect. Since 2023-08-16, apps that offer Game Center features must have both the entitlement and the App Store Connect configuration. Authenticate the local player before use. Leaderboards (including recurring), achievements, challenges, activities, and the access point are all configurable through ASC API v2. Game Center items can be submitted for review separately (4.2). Capacitor needs a native plugin bridge.

---

## 6. fastlane

Sources: https://docs.fastlane.tools/app-store-connect-api/ · https://github.com/fastlane/fastlane/releases · https://rubygems.org/gems/fastlane

- fastlane is actively maintained. Latest is **2.241.1 (2026-10-15)**, which added iPhone Duo screenshot sizes to deliver. Ruby ≥3.1.
- Key-based auth (`app_store_connect_api_key` action, or `api_key_path` JSON) is supported by **pilot, deliver, match, cert, sigh, precheck, download_dsyms, and app_store_build_number**. No 2FA is needed.
- **produce** (app creation): **no API key support**, only "Partial" via Apple ID. An attempt to add API-key create support was **reverted in 2.241.1**, consistent with Apple having no create-app endpoint. App creation needs an Apple ID session, which means 2FA and fragile cookies, or a manual step.
- **precheck:** IAP checks are not supported by either auth method.
- **pem:** Apple ID only. Use APNs token auth (.p8) instead.
- `upload_app_privacy_details_to_app_store`: uses an Apple ID web session (an inference consistent with the absence of an API endpoint; not explicitly verified in the fastlane docs).
- **Risk:** deliver still targets the screenshot/preview set endpoints that ASC API 4.5.1 deprecated in favor of the App Asset Library. No fastlane release migrating to it has been seen. Watch for one, or call the Asset Library API directly.
- Recent fixes: deliver/pilot app coverage files and duplicate-image prevention (2.239), pilot group matching by ID (2.238), and an altool reporting failure on a successful upload (2.240).

---

## 7. Apple Ads API (formerly Apple Search Ads)

Sources: https://developer.apple.com/documentation/apple_ads · https://developer.apple.com/documentation/apple_ads/apple-search-ads-campaign-management-api-5 · https://developer.apple.com/documentation/apple-ads-platform-api

- **The Apple Ads Campaign Management API (v5) is deprecated and will be sunset on 2027-01-26.** Its last release was 5.6 (June 2026), which removed lifetime budgets (`dailyBudgetAmount` only). **Build on the new Apple Ads Platform API**, which covers App Store and Apple Maps ads in a single REST API, with a Python generated client available.
- **Auth (both APIs):** OAuth2 client credentials.
  1. An admin invites an API-role user at ads.apple.com.
  2. Generate an EC P-256 key pair and upload the public key in Account Settings > API.
  3. Sign a client-secret JWT (ES256, `aud=https://appleid.apple.com`, `iss=teamId`, `sub=clientId`, `exp` ≤180 days).
  4. Exchange it for an access token.
  5. Send `Authorization: Bearer` and `X-AP-Context: orgId` on each request.
- **Platform API setup:** the ad account needs `productFeatures: ["APPSTORE_APP_MANUAL"]` and a `CONTENT_PROVIDER` delegation with your CPID. Delegations use full-replacement semantics, so always send the complete array.
- **Campaigns:** campaigns, budget orders, ad groups, keywords and negative keywords, geo targeting, ads/creatives/assets, custom product page ads, bulk operations, recommendations, insights, change history.
  - Placements: search results, Search tab, Today tab, product pages.
  - Campaigns target countries or regions. Check each app's `availableStorefronts` and app-eligibility per market first.
  - Bid strategy "Maximize Conversions" (target CPA) was added in 5.5 (Feb 2026).
- **Reporting:** campaign, ad group, keyword, search term, and ad-level reports, plus impression share. Tap-through and view-through installs, plus preorder metrics (5.4).
- **Rate limits (Platform API):** `RateLimit-Limit/Remaining/Reset` headers. A 429 includes `Retry-After`. Back off exponentially up to about 16 s. Numeric quotas are not published.

---

## 8. Organization enrollment

Sources: https://developer.apple.com/programs/enroll/ · https://developer.apple.com/help/account/membership/D-U-N-S/

- **Legal entity required:** corporation, LP, or LLC. "We do not accept DBAs, fictitious business names, trade names, or branches." Sole proprietors must enroll as individuals. The legal entity name becomes the **seller name** on the App Store.
- **D-U-N-S number** is required and free from D&B. Look up first at developer.apple.com/enroll/duns-lookup. A new number takes **up to 5 business days** (expediting doesn't help; email D&B after 2 weeks), then **up to 2 business days** for Apple to receive it.
- Enrollee requirements: Apple Account with 2FA, legal name, and legal binding authority (owner, exec, or delegated).
- Organization requirements: work email on the organization's domain, and a **public, functional website on that domain** (not social pages or parked domains).
- **Fee: 99 USD per membership year** (local pricing varies). Fee waivers are only for nonprofits, accredited education, and government.
- Then Apple verifies the information, you accept the Program License Agreement (updated 2026-10-13), and pay. Paid apps and IAP also need the Paid Apps agreement, tax, and banking in App Store Connect.
- Total realistic timeline: about 1–3 weeks (D-U-N-S + Apple verification). Apple doesn't publish an enrollment-verification SLA.

---

## Implications for our design

- **One manual step per game:** a human must create the App Store Connect app record (name + bundle ID + SKU) and fill in the privacy label. The pipeline should pause at a "create app record" checklist, then automate everything else through the ASC API with a team key.
- Use the ASC API directly, with fastlane only where it adds value (match for signing, pilot/deliver). Don't depend on `produce` or Apple-ID-session actions in CI.
- Build the asset pipeline against the **App Asset Library** (new 4.5.1 endpoints), not the deprecated screenshot sets. Read the required sizes from `appAssetLibraryRefData`. Plan for **iPhone Duo screenshots, mandatory from April 2027**.
- Prefer **webhooks** (build upload, version state, TestFlight feedback) over polling. Budget polling to stay under the per-key hourly limit (example limit 3,500/hr) and handle 429 with queued retries.
- **4.3 is the existential risk.** A catalog of reskins can get the *developer account* terminated. Gate each game on a "distinct mechanic" review, give each its own metadata and art, and space out submissions. Consider a single arcade host app as a fallback architecture.
- **No remote code:** bundle all game JS/assets in the binary. No OTA live-update of gameplay (2.5.2, 2.5.19). Ship real native touches (Game Center, haptics, StoreKit) to clear 4.2.
- IAP: use a **StoreKit 2-based** Capacitor plugin, App Store Server Notifications **V2**, and no `verifyReceipt`. Currency must never expire, and restore must work. Show **loot box odds** before purchase if we ever randomize paid items.
- Default to **no tracking SDKs** (skip ATT, simpler labels, eligible for younger ratings). If ads are added, budget for ATT (EU alternative prompt), label changes, and a privacy manifest for every native SDK.
- **Avoid the Kids Category** unless a game is designed for it, because third-party analytics and ads are effectively banned there.
- Automate the **age rating questionnaire** via `PATCH ageRatingDeclarations`, but expect the schema to keep changing (social media, Korea, Australia, Vietnam). Treat it as versioned config per game.
- Expect review latency of about 24–48 h (90% < 48 h) plus beta review for the first external build per group. Use TestFlight **public links** with a cap for playtests. Builds expire after 90 days.
- Phased release can't be used on v1.0, only on updates.
- Ads automation: target the **Apple Ads Platform API** now. The Campaign Management API dies **2027-01-26**.
- Enrollment: get the LLC, D-U-N-S, and domain website done first. That path takes 1–3 weeks.

## Open questions / couldn't verify

- Actual ASC API rate limits for our keys (Apple's 3,500/hr is an example). Whether limits differ by endpoint.
- Whether App Store Server Notifications URL and other app-level settings can be set through the API (no endpoint found in the spec on a quick scan).
- When, or whether, the deprecated screenshot/preview endpoints will be removed. Whether fastlane `deliver` will migrate to the App Asset Library.
- Beta App Review turnaround times (no official figure).
- Whether "build uploads" via the API fully replaces altool/Transporter for IPA uploads in practice. The docs conflict: the Apps page says the API can't upload builds, while release notes 4.1 added `buildUploads`.
- Full text of the 2026-06-08 guideline changes (only the summary was read). Whether any 2026 changes touched 4.2/4.3 (the Oct 16 change list names none).
- The App Store Small Business Program (15% commission) and current commission rates were not checked. Only the EU (5% Core Technology Commission from 2026-10-01) and China (25%/12% from 2026-03-15) changes were seen in the news.
- How App Review currently treats Capacitor/WebView games specifically. The guidelines don't mention frameworks, so the advice above is inferred from 4.2/2.5.2.
- Exact list of required-reason APIs touched by Capacitor core and plugins. Check that each plugin ships `PrivacyInfo.xcprivacy` and a signature.
- Apple Ads Platform API numeric quotas and pricing/eligibility per country. Read the Platform API "journey" docs in full before building.
