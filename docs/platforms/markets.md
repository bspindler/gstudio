# Soft-Launch Markets for Casual / Hyper-Casual Mobile (non-EU)

Researched 2026-10-25. EU/EEA markets are excluded by policy, including Norway, Iceland and Liechtenstein, since GDPR applies there through the EEA. Public, country-level casual CPI data is scarce. Ranges below are synthesized from vendor reports and labeled by confidence; re-check them against live bids before budgeting.

## Benchmarks used

- **Liftoff 2025 Casual Gaming Apps Report** (data Feb 2024 to Feb 2025; published 2025-07-28): casual CPI **iOS ~$1.41, Android ~$0.14** (global blend); D30 ROAS 47% iOS and 15% Android. Liftoff's older regional cut (2022): LATAM casual CPI $0.66 vs North America $3.32, about 5x.
- **Adjust** (via gamegrowthadvisor, 2026-03): blended gaming CPI $0.56 globally, $1.68 North America; hybrid-casual Android CPI rose from $0.54 to $0.95 between 2024 and 2025.
- **gamegrowthadvisor 2026 synthesis** (Android casual/puzzle): US $1.50-3.50; UK/CA/AU $1.00-2.50; LATAM $0.15-0.60; SEA $0.20-0.60; India $0.08-0.30. For iOS, it suggests multiplying by 3-4x (low confidence).
- **Admiral Media 2025**: casual puzzle Android $0.80-2.00, iOS $1.50-3.50 (managed spend, Tier 1 weighted).
- **GameAnalytics 2026 benchmarks** (2025 data, all genres): D1 median ~22%, P75 ~30%, P90 ~40%; D7 median under 4%, P75 6-7%; D30 median ~0.7%. In the 2025 report, iOS P75 D1 was 31-33% vs Android 25-27%.
- **Sensor Tower State of Gaming 2026** (via CGM): 2025 game downloads fell 7% YoY to ~50B while IAP revenue rose 1.4% to $82B. Installs are getting pricier, which favors cheap-geo retention filters.

## Rough CPI ranges by tier (casual / hyper-casual, 2025-2026)

| Tier | Markets | Android CPI | iOS CPI | Confidence |
|---|---|---|---|---|
| 3 | PH, MY, TH, ID, BR, MX (IN cheaper still) | $0.05-0.60 (IN $0.08-0.30; hyper-casual often under $0.15) | $0.30-1.50 | Low to moderate |
| 2 | CA, AU, NZ (SG) | $1.00-2.50 | $2.00-5.00 | Moderate |
| 1 | US | $1.50-3.50 | $2.50-6.00+ | Moderate |
| 1 | UK | ~20-40% below US | ~20-40% below US | Low to moderate |
| 1-loc | JP, KR, TW | $1.50-4.00 | $3.00-8.00 | Low (no casual-specific public data found) |

Hyper-casual sits at the low end and hybrid-casual at the high end. iOS ranges are derived from Android via the 3-4x heuristic and Liftoff's global iOS/Android gap, not measured per country.

## Recommended tiers

### Tier 3: retention and fun signal (cheap installs)
- **Philippines (PH)**: the most-used soft-launch market. English-speaking, Android-heavy, cheap. Law: Data Privacy Act 2012 (NPC).
- **Malaysia (MY)**: English widely used, decent iOS share. Law: PDPA as amended 2024 (cross-border and penalty changes from 2025-04-01; DPO appointment and breach notification from 2025-06-01; fines up to RM1M).
- **Thailand (TH)**: large casual audience; needs Thai localization for a clean signal. Law: PDPA B.E. 2562 (enforced June 2022).
- **Brazil (BR)**: LATAM proxy with big volume and cheap installs. Needs PT-BR. Law: LGPD, plus **ECA Digital (Law 15.211/2025, in force 2026-03-17)**: age assurance, parental tools, **no loot boxes** in games aimed at or likely accessed by minors, fines up to 10% of BR revenue. The store rating is ClassInd via IARC.
- **Mexico (MX)**: Spanish-LATAM proxy. Law: new LFPDPPP (published 2025-03-20, in force 03-21). INAI dissolved; the authority is now the Secretariat of Anti-Corruption and Good Governance.
- **Indonesia (ID)**, conditional: very cheap with huge volume. Law: PDP Law 27/2022 (fully applicable from 2024-10-17). Quirks: an **IGRS age rating is mandatory for every game accessible in ID (fully enforced since 2026-01-24, Permenkominfo 2/2024)**. IARC ratings are meant to map automatically, but Komdigi spot-checks. **PSE registration** may apply to games with accounts, IAP or personal-data processing, and Komdigi has blocked non-registered platforms. Include only once we confirm IARC/IGRS mapping works for our store listings.
- **India (IN)**, optional, Android only: cheapest installs, but low monetization and retention tends to read low, so keep its numbers separate. Law: DPDP Act 2023 + DPDP Rules (notified ~2025-11-14). Most obligations land at 18 months (~May 2027), including **verifiable parental consent for under-18s**. The Online Gaming Act 2025 bans real-money games; casual games are unaffected.
- **Vietnam (VN): excluded for now.** Decree 147/2024 (in force 2024-12-25) requires a game license or notice (G4 = offline) before stores may list a game. Cross-border online games are prohibited without a local entity. PDPL 91/2025 is in force from 2026-01-01.

### Tier 2: English monetization signal
- **Canada (CA)**: classic US proxy. Law: PIPEDA. **Quebec Law 25** (fully in force since Sept 2024) requires privacy-by-default, consent for tracking tech, and a privacy officer. Quebec's Charter of the French Language (Bill 96) has French-availability expectations for software and commerce. Bill C-27 died in Jan 2025.
- **Australia (AU)**: Privacy Act 1988 with the 2024 amendments (statutory privacy tort from June 2025; OAIC Children's Online Privacy Code in development). Quirk: classification rules from **2024-09-22** set a minimum **M rating for paid chance-based items (loot boxes)** and **R18+ for simulated gambling**. They apply to mobile through IARC. The under-16 social media minimum age (from Dec 2025) excludes online games.
- **New Zealand (NZ)**: Privacy Act 2020. The Privacy Amendment Act 2025 adds IPP3A (notice for indirectly collected data, from 2026-05-01; verify).
- **Singapore (SG)**, optional: small but English-speaking and high-ARPU. Law: PDPA 2012.

### Tier 1: scale
- **United States (US)**: COPPA, with the amended Rule effective 2025-06-23 and compliance by 2026-04-22. State privacy laws (CCPA/CPRA and ~20 others). **State app-store age-verification laws** (UT, TX, LA, CA AB 1043) are rolling out 2026-2027 with litigation pending; check status at launch.
- **United Kingdom (GB)**: not EU. **UK GDPR + DPA 2018**, as amended by the Data (Use and Access) Act 2025. The ICO Age Appropriate Design Code applies if children are likely users. The Online Safety Act applies mainly if we add UGC or chat. PECR cookie/SDK consent still applies.
- **Japan (JP)**, localized: APPI. **Kompu gacha (complete-gacha) is banned** under the Premiums and Representations Act.
- **South Korea (KR)**, localized: PIPA. **Mandatory loot-box probability disclosure** under the Game Industry Promotion Act since 2024-03-22. Ratings come through GRAC/IARC self-rating.
- **Taiwan (TW)**, localized: PDPA. The Game Software Rating regulations require loot-box probability disclosure.

## Store-wide quirks

- Google Play uses **IARC**, which issues local ratings for ACB (AU), ClassInd (BR), GRAC (KR) and others. Apple uses its own age ratings, which were reworked in 2025 (4+/9+/13+/16+/18+, with a new questionnaire required for updates from early 2026).
- Both stores now pass age-range signals (Apple Declared Age Range API; Google Play Age Signals API) in jurisdictions with app-store age laws. Plan for these signals to gate ads personalization.
- Loot boxes: avoid paid random rewards entirely in v1. That sidesteps BR (ban for minors), AU (M rating), and KR/TW/JP disclosure rules, plus store probability-disclosure policies.

## Implications for our design

- The pipeline's mobile gate is **D1/D7 retention in Tier 3** (PH first, then MY/TH/BR/MX). Use GameAnalytics P50/P75 as kill/keep bands, e.g. kill if D1 is under 22%, promote if D1 is 30% or more and D7 is 6% or more. Hyper-casual bands may need to be lower.
- Keep **per-country cohorts**. Never blend IN/ID with PH/MY when judging retention.
- Monetization signal (ARPDAU, ad eCPM, IAP conversion) comes only from **Tier 2 (CA/AU/NZ)**. Tier 3 revenue numbers are not predictive.
- Localization budget: EN covers PH, MY, SG and Tier 2. Add PT-BR, ES-MX and TH next; FR-CA if Quebec traffic matters; JA/KO/ZH-TW only at Tier 1 expansion.
- Privacy baseline: one global consent/notice flow that satisfies the strictest non-EU rule set (UK GDPR / Quebec Law 25 / LGPD). Data minimization, no precise location, no contact data in v1, analytics consent where required, a hosted privacy policy, and a deletion request path.
- **No paid random rewards and no gambling themes.** Design for 13+ but child-safe ("likely accessed by children" is a broad test in UK AADC and BR ECA Digital): no behavioral ads for unknown-age users in BR/UK/US, and use age signals from the stores.
- Treat ID (IGRS/PSE) and VN (licensing) as compliance-gated markets. Default VN off and add ID only after a rating check.
- CPI budgets: a Tier 3 retention test of ~1-2k installs costs roughly $200-1,000 on Android. A Tier 2 monetization test of ~1-2k installs costs roughly $2-5k on Android, with iOS 2-4x higher.

## Open questions

- Actual live CPIs per country for our genre: run a $50-100 probe per geo on Unity/AppLovin/Meta before committing.
- Indonesia: does IARC to IGRS mapping happen automatically for Apple listings, or only Google Play? Does a no-account, no-IAP game need PSE registration?
- Vietnam: does an offline G4 game from a foreign publisher still need a local entity or notice to be listed on the stores?
- Quebec Bill 96: do we need a French UI to distribute in Quebec, or does Canada-wide distribution in EN-only suffice for soft launch?
- US state app-store age laws (TX SB 2420, UT, LA, CA AB 1043): current injunction status at our launch date, and the developer-side obligations.
- India DPDP: do we treat all users as possibly under 18, or avoid IN until the parental-consent tooling is clear (~May 2027)?
- Is SG worth including in Tier 2 given its small volume?
- The GameAnalytics benchmarks are all-genre. We need casual or hyper-casual-specific D1/D7 bands (the full PDFs may have genre splits).

## Sources

- Liftoff 2025 Casual Gaming Apps Report: https://liftoff.ai/2025-casual-gaming-apps-report/ and highlights (2025-07-28): https://liftoff.ai/blog/highlights-2025-casual-gaming-apps-report/
- gamegrowthadvisor CPI benchmarks 2026 (2026-03-17): https://gamegrowthadvisor.com/blog/2026-03-17-user-acquisition-cpi-benchmarks-2026/
- Admiral Media benchmarks: https://admiral.media/mobile-game-marketing-benchmarks/
- The Social Outline gaming CPI (Liftoff/Adjust citations): https://thesocialoutline.com/blog/cpi-benchmarks-mobile-gaming
- GameAnalytics 2026 benchmarks summary: https://gamedevreports.substack.com/p/gameanalytics-mobile-and-pc-game ; 2025 report: https://gamedevreports.substack.com/p/gameanalytics-mobile-gaming-benchmarks
- Sensor Tower / AppsFlyer 2026 context (via CGM): https://www.cgmagonline.com/articles/phone-gets-new-games/
- Soft-launch market footprints: https://mobilegamer.biz/the-soft-launch-games-you-need-to-know-about/ ; https://mobilegamer.biz/overwatch-rush-enters-soft-launch-in-the-philippines-malaysia-and-indonesia/
- Brazil ECA Digital in force 2026-03-17: https://www.demarest.com.br/en/eca-digital-entrada-em-vigor-em-17-de-marco-de-2026/ ; guide: https://www.demarest.com.br/wp-content/uploads/2026/03/Cartilha-ECA-Digital_EN.pdf
- Australia loot box / simulated gambling classification: https://classification.gov.au/about-us/media-and-news/news/new-mandatory-minimum-classifications-for-gambling-games-content
- Malaysia PDPA amendments: https://insightplus.bakermckenzie.com/bm/data-technology/malaysia-personal-data-protection-amendment-act-2024-to-come-into-force
- Mexico new LFPDPPP: https://whitecase.com/insight-alert/mexico-enacts-new-data-protection-regime
- India DPDP Rules (PIB): https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf ; AZB summary: https://www.azbpartners.com/bank/update-indias-digital-personal-data-protection-framework-comes-into-effect/
- Vietnam PDPL 91/2025: https://www.allenandgledhill.com/sg/publication/articles/31075/upcoming-changes-to-vietnam-s-personal-data-protection-regime
- Vietnam Decree 147/2024 (games licensing): https://www.allenandgledhill.com/perspectives/articles/29440/vnkh-introduces-additional-requirements-relating-to-provision-of-information-and-internet-services ; https://www.pocketgamer.biz/vietnam-issues-decree-1472024-to-regulate-online-games-and-internet-services
- Indonesia IGRS / PSE: https://www.cekindo.com/blog/pse-license-and-igrs ; https://substack.nikopartners.com/p/indonesia-game-rating-system-heavily
- From background knowledge, not re-fetched this session (verify before relying on them): PH Data Privacy Act 2012 (privacy.gov.ph); Indonesia PDP Law 27/2022; Thailand PDPA; Canada PIPEDA / Quebec Law 25 (cai.gouv.qc.ca); AU Privacy Act amendments (oaic.gov.au); NZ Privacy Amendment Act 2025 (privacy.org.nz); US COPPA amended Rule (ftc.gov); UK DUAA 2025 / AADC (ico.org.uk); KR probability disclosure (2024-03-22); JP kompu gacha ban; Apple age-rating update (developer.apple.com/news).

## Config snippet

```yaml
# markets.yaml (researched 2026-10-25; EU/EEA excluded)
markets:
  excluded:
    regions: [EU, EEA]           # incl. NO, IS, LI
    countries: [VN, CN]          # VN: Decree 147/2024 licensing; CN: ISBN license
  tiers:
    tier3:
      purpose: retention_fun_signal
      countries: [PH, MY, TH, BR, MX]
      conditional: [ID]          # enable after IGRS rating confirmed
      optional: [IN]             # android-only, separate cohort
      platforms: [android, ios]
      cpi_usd: {android: [0.05, 0.60], ios: [0.30, 1.50]}
      gates: {d1_kill_below: 0.22, d1_promote_at: 0.30, d7_promote_at: 0.06}
      rationale: "Cheap installs, English (PH/MY), large casual audiences; standard soft-launch footprint."
      notes:
        PH: "Data Privacy Act 2012"
        MY: "PDPA amended 2024; DPO + breach notice from 2025-06-01"
        TH: "PDPA 2019 (enforced 2022); needs TH localization"
        BR: "LGPD + ECA Digital (2026-03-17): no loot boxes for minors, age assurance; PT-BR"
        MX: "New LFPDPPP 2025-03-21; ES-MX"
        ID: "PDP Law 27/2022; IGRS rating mandatory since 2026-01-24; PSE may apply"
        IN: "DPDP Act + Rules (2025-11); parental consent <18 by ~2027-05"
    tier2:
      purpose: monetization_signal_english
      countries: [CA, AU, NZ]
      optional: [SG]
      platforms: [ios, android]
      cpi_usd: {android: [1.00, 2.50], ios: [2.00, 5.00]}
      rationale: "English-speaking, US-like spend; standard pre-global monetization check."
      notes:
        CA: "PIPEDA; Quebec Law 25; Bill 96 French expectations"
        AU: "Privacy Act (2024 amendments); loot boxes => M, simulated gambling => R18+ (2024-09-22)"
        NZ: "Privacy Act 2020; IPP3A from 2026-05-01"
        SG: "PDPA 2012"
    tier1:
      purpose: scale
      countries: [US, GB]
      localized_next: [JP, KR, TW]
      platforms: [ios, android]
      cpi_usd: {android: [1.50, 3.50], ios: [2.50, 6.00]}
      rationale: "Largest revenue pools; UK is non-EU (UK GDPR)."
      notes:
        US: "COPPA amended rule (compliance 2026-04-22); state privacy laws; state app-store age laws"
        GB: "UK GDPR + DPA 2018 + DUAA 2025; ICO Children's Code; PECR"
        JP: "APPI; kompu gacha banned"
        KR: "PIPA; loot-box probability disclosure (2024-03-22)"
        TW: "PDPA; loot-box probability disclosure"
  design_constraints:
    paid_random_rewards: false
    gambling_themes: false
    target_age_rating: "13+ / child-safe"
    consent_model: "strictest non-EU (UK GDPR / Law 25 / LGPD)"
```
