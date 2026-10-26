# Ads via official APIs (TikTok, Meta, Apple Search Ads) and attribution

Researched 2026-10-25. Statements are verified on official pages unless marked *(unverified)*. Several TikTok API for Business doc pages render client-side, so the fetch could not read them; those items are flagged.

---

## 1. TikTok Ads (TikTok API for Business / Marketing API v1.3)

Sources:
- https://business-api.tiktok.com/portal/docs/register-as-a-developer/v1.3
- https://business-api.tiktok.com/portal/docs/create-a-developer-app/v1.3
- https://business-api.tiktok.com/portal/docs/marketing-api-get-started/v1.3 (JS-rendered; content seen only via search snippets)
- https://ads.tiktok.com/help/article/budget (last updated July 2026)
- https://ads.tiktok.com/help/article/what-is-app-promotion-objective
- https://ads.tiktok.com/resources/help/article/set-up-app-attribution-tiktok-ads-manager
- https://ads.tiktok.com/help/article/how-to-generate-a-tiktok-app-id
- https://ads.tiktok.com/help/article/measurement-considerations-ios14

**Access approval**
- Register a developer profile. TikTok vets the company: the contact email must be on a verified company domain (personal emails are rejected), and **individual developers can't currently be onboarded**.
- After the profile is approved, create a developer app (up to 5 per developer). The app asks for:
  - an app description
  - intended use and scopes
  - an advertiser redirect URL
- App review takes about 2-3 business days; you can resubmit after a rejection.
- The advertiser then authorizes the app through OAuth. The auth code is exchanged for a long-term access token, sent in the `Access-Token` header to `https://business-api.tiktok.com/open_api/v1.3/`.
- Since 2026-03-20, the "TikTok Accounts" scope needs a separate Accounts API access form. We don't need that scope for ads.

**Campaign and ad group creation** *(endpoint names from memory; the reference pages could not be fetched)*
- `campaign/create/` with `objective_type=APP_PROMOTION`.
- `adgroup/create/` with the `app_id`, an optimization goal (Install, In-app event, or Value), placements, `location_ids` for country targeting, OS targeting, budget, and schedule.
- `ad/create/` with the creative: a video uploaded through `file/video/ad/upload/`, plus the identity used.
- App Promotion has Install and Retargeting sub-types.
- iOS 14+ dedicated campaigns are reported from SKAN data only.

**Budget minimums** (official help, July 2026)

| Level | Daily minimum | Lifetime minimum |
|---|---|---|
| Campaign | must exceed $50 | must exceed $50 |
| Ad group | must exceed $20 | days × $20 (e.g. 31 days needs $620) |

- These are shown in USD; other currencies have local equivalents.
- Budget type (daily vs lifetime) can't be changed after launch.
- You can avoid the campaign-level floor by leaving the campaign budget unlimited and setting only the ad group budget. The ad group floor of just over $20/day still applies. *(Unverified that the $50 campaign floor is skippable via "no limit"; this is common practice.)*

**Prerequisites for app install campaigns**
- A TikTok App ID per platform (iOS and Android are separate), created in Events Manager.
- An event source, verified with that App ID: an MMP (Adjust, AppsFlyer, Branch, Kochava, Singular, Tenjin, Airbridge), the TikTok App Events SDK, or the Events API.
- On iOS, **exactly one SDK may own SKAN conversion-value updates**. An MMP and the TikTok SDK can run together ("hybrid"), but only one of them sets SKAN.

**Reporting** *(endpoint from memory)*
- `report/integrated/get/` (synchronous) and async report tasks.
- Report levels: advertiser, campaign, ad group, and ad. Dimensions include `country_code`. Metrics include spend, impressions, clicks, installs (`app_install`/`conversion`), CPI, and video views.

---

## 2. Meta Marketing API

Sources:
- https://developers.facebook.com/docs/marketing-api/overview/authorization (examples on v26.0)
- https://developers.facebook.com/docs/graph-api/overview/access-levels
- https://developers.facebook.com/docs/marketing-api/mobile-app-ads
- https://developers.facebook.com/docs/marketing-api/reference/ad-account/minimum_budgets/
- https://developers.facebook.com/docs/marketing-api/insights
- https://developers.facebook.com/docs/app-events/getting-started-app-events-ios
- https://developers.facebook.com/documentation/ads-commerce/conversions-api/app-events
- https://www.facebook.com/business/help/203183363050448 (Minimum budgets help; body not readable)

**Access levels** (recently renamed, same permission IDs)
- Marketing API Access Tier: Limited (the default, formerly "Standard Access") or Full (formerly "Advanced Access", requires App Review).
- Limited access: "heavily rate-limited per ad account" and "Not for production apps running for live advertisers". Only 1 system user plus 1 admin system user.
- Full access: requires at least 500 successful calls in the last 15 days with an error rate below 15%. Up to 10 system users.
- **Managing only our own ad account needs only standard access to `ads_management`/`ads_read`**. Advanced/Full is needed to manage other people's accounts.
- Advanced Access requires Business Verification.

**App install campaigns**
- Register the app in the Meta App Dashboard: iOS bundle ID and Android package name, linked to an ad account and a business portfolio. A Facebook Page is required to run ads.
- Campaign objective `OUTCOME_APP_PROMOTION`. The legacy `APP_INSTALLS` objective still appears in docs.
- Ad set:
  - `promoted_object` with `application_id` and `object_store_url`, plus `custom_event_type` when optimizing for an event.
  - `optimization_goal`: `APP_INSTALLS` or `OFFSITE_CONVERSIONS`.
  - Targeting: `user_os`, and `device_platforms: ["mobile"]`.
- Creative: an ad video uploaded to `/act_<id>/advideos`, used with an `object_story_spec` call-to-action of type `INSTALL_MOBILE_APP`.

**Country targeting**
- Ad set `targeting.geo_locations.countries: ["CA","NZ",...]`. *(Standard Graph targeting spec; not re-read today.)*

**Minimum budgets**
- `GET /act_<id>/minimum_budgets` returns the minimum daily budget for an auction ad set, in the account currency. **Query it instead of hard-coding values.**
- *(Unverified, third-party sources citing Meta help)*: about $1/day for impression-billed ad sets, about $5/day for clicks/conversions, and higher for low-frequency events. The guidance is to set budget ≥ 5× the target cost per result.
- Learning phase needs about 50 optimization events per week per ad set. *(Unverified)*

**Reporting**
- `GET /{object-id}/insights` at account, campaign, ad set, or ad level, with the `ads_read` permission.
- Use `fields` (spend, impressions, clicks, actions), `breakdowns` (e.g. `country`), `date_preset` or `time_range`, and attribution-window parameters.
- Async jobs are available for large reports.

**App events / SDK, and the Capacitor question**
- Native SDK route:
  - iOS: Facebook iOS SDK via SPM, with App ID, client token, and URL scheme in Info.plist. App Install is auto-logged. Set `isAdvertiserTrackingEnabled` from the ATT result. SKAdNetwork campaigns need event priority (conversion value) configured.
  - Android: the equivalent Android SDK.
- Server route: the **Conversions API for App Events** (`action_source=app`, dataset-bound). Requires `app_data.advertiser_tracking_enabled` and `extinfo` (with `i2`/`a2` device-info prefixes), plus `event_id` for deduplication.
- **Capacitor:** a Capacitor app is a native iOS/Android shell, so the native Meta SDK can be added to the native projects. Meta ships no official Capacitor plugin. A community plugin, `@capgo/capacitor-facebook-analytics` (iOS and Android only, no web), exposes init, logEvent, logPurchase, and advertiser-tracking toggles. Alternatively, log events from the server with the Conversions API and skip the SDK, but install attribution still needs on-device signals (SKAN/AAK on iOS, Install Referrer on Android) or an MMP.

---

## 3. Apple Search Ads

- Covered in `docs/platforms/apple.md` (another agent). Key point for the comparison: Apple Ads attribution uses the AdServices framework (an on-device token), which needs no ATT prompt and no MMP.

---

## 4. General: small soft-launch budgets and attribution

Sources:
- https://ads.tiktok.com/help/article/budget
- https://developer.apple.com/app-store/ad-attribution/
- https://developer.apple.com/documentation/adattributionkit/postback
- https://developer.apple.com/videos/play/wwdc2024/10060/ (Meet AdAttributionKit)
- https://developer.apple.com/videos/play/wwdc2025/221/ (What's new in AdAttributionKit)
- https://developer.android.com/google/play/installreferrer (last updated 2025-07-21)

**What minimums mean for a soft launch**
- TikTok's hard floor is just over $20/day per ad group, about $600+/month per running ad group. A 7-day test of one ad group costs at least about $140. **A strict cap such as "$10/day total" is impossible on TikTok.** The smallest TikTok test is 1 ad group × 1 country × 3-7 days.
- Meta's floors are much lower, but useful optimization still needs about 50 events per ad set per week. At a $1-3 tier-3 CPI that is roughly $50-150/week per ad set. Below that, optimize for cheaper signals (installs, not purchases) and accept noisy data.
- Practical pattern: one platform at a time, one ad set, 1-2 cheap soft-launch countries (e.g. PH, CA, NZ, AU, or Nordics for Western proxies), daily budget at the platform floor, lifetime/end date set, and our own server-side kill switch that pauses through the API once cumulative spend reaches the cap.
- Platforms can overspend daily budgets slightly; Meta has historically allowed up to about 75% over on a given day *(unverified)*. Enforce caps with lifetime budgets and end dates, not just daily budgets, and add an account-level spending limit (Meta `spend_cap`, TikTok account budget) as a backstop.

**Attribution**
- iOS:
  - SKAdNetwork and AdAttributionKit (iOS 17.4+ for installs, iOS 18+ for re-engagement) are interoperable.
  - Postbacks are aggregated, delayed, and crowd-anonymity gated, with no user-level data and no ATT needed.
  - The advertised app sets conversion values (fine 0-63, coarse low/medium/high, optional lock) via `Postback.updateConversionValue` (AAK) or `SKAdNetwork.updatePostbackConversionValue`. **Only one SDK in the app may set them.**
  - Ad networks receive postbacks directly. We can receive copies by setting the postback-copy URL key in Info.plist (`NSAdvertisingAttributionReportEndpoint` for SKAN; AAK has an equivalent key *(verify exact name)*).
- Android:
  - The Play Install Referrer API (via the Install Referrer client library) gives the referrer URL, click/install timestamps, and the install version.
  - Ad networks append their click IDs to the Play referrer. Reading it is first-party and needs no user-level ID.
- **Lightest privacy-compliant option (no MMP)**:
  - iOS: no ATT prompt, no IDFA. Let the ad networks read SKAN/AAK postbacks natively (TikTok and Meta both report SKAN), set a simple conversion-value schema ourselves (e.g. install = 0, tutorial complete, day-1 return), and receive postback copies on our own endpoint.
  - Android: read the Install Referrer on first launch and send it to our server.
  - Network signals: send install and key events server-side through the Meta Conversions API for App Events and the TikTok Events API (each needs its App ID and dataset).
  - Disclose all of this in the App Store privacy label, the Play Data safety form, and our privacy policy.
- **When an MMP is worth it**: for multi-network deduplication, cross-network reporting, or simpler SDK maintenance. Free or low tiers exist *(verify current pricing)*; for example, Tenjin and Singular have historically had free/starter tiers and AppsFlyer has a "Zero" plan. With a single network at small spend, it is optional.

---

## Implications for our design

- **Budget engine must respect platform floors**: TikTok ad group > $20/day (campaign > $50 if a campaign budget is set). For Meta, read `/minimum_budgets` per ad account and currency. Refuse to create an ad group whose floor exceeds the remaining soft-launch cap.
- **Hard spend caps are enforced by us plus platform backstops**: lifetime budget, end date, and an account-level spend cap, plus a poller that reads spend (TikTok report API, Meta Insights) and pauses through the API at the cap. Assume a lag of hours in the spend data.
- **TikTok Marketing API onboarding needs a registered company with a company-domain email**; individuals are blocked. Meta needs a Business portfolio, a Page, a registered app, and (for Advanced/Full) Business Verification. Our own ad account only needs standard `ads_management`.
- **Capacitor is fine**: integrate attribution natively. Prefer a single attribution owner on iOS (our own tiny SKAN/AAK conversion-value module, or the TikTok/Meta SDK, but only one). Android reads Install Referrer. Send server-side events to the Meta Conversions API and the TikTok Events API.
- **No ATT prompt in v1** keeps us privacy-light; iOS reporting will then be SKAN/AAK only (delayed 24-72 h+, aggregated). Expect noisy, small-sample iOS data at soft-launch budgets, and lean on Android for early signal.
- **Clip pipeline to ad creative**: the same 9:16 MP4 can be uploaded as an ad video (TikTok `file/video/ad/upload`, Meta `/advideos`). Keep ad creatives separate from the organic posting flow and its consent rules.

## Open questions / couldn't verify

- TikTok Marketing API reference pages (campaign/adgroup/report fields, rate limits, sandbox) are JS-rendered and couldn't be fetched. Field names above are from memory.
- Whether the TikTok campaign-level $50 floor can be bypassed with an unlimited campaign budget plus a $20 ad group.
- Meta's official per-objective minimum budgets (the help article body was not readable). Use `/minimum_budgets` at runtime.
- Meta's daily overspend allowance for current versions.
- Exact AdAttributionKit Info.plist key for postback copies, and whether TikTok and Meta already consume AAK postbacks (vs SKAN only) as of 2026-10.
- Current free-tier availability and pricing of MMPs.
- Whether the Meta Conversions API for App Events alone (no SDK) can drive install-optimized campaigns, or only event reporting.
