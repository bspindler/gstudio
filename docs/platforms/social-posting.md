# Social posting via official APIs (TikTok, Instagram Reels, YouTube Shorts)

Researched 2026-10-25 from official developer docs. "Verified" means read on the official page on that date. Anything marked *(unverified)* comes from memory or a third-party source and needs checking before we build on it.

Our clip profile: 9:16 vertical, 15-30 s, H.264/AAC MP4, 1080x1920, 30 or 60 fps. This profile fits all three platforms' specs below.

---

## 1. TikTok Content Posting API

Sources:
- https://developers.tiktok.com/doc/content-posting-api-get-started (last updated 2026-08-04)
- https://developers.tiktok.com/doc/content-sharing-guidelines
- https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
- https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
- https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content (Upload/inbox flow; fetch returned 403, so details come from search snippets)
- https://developers.tiktok.com/doc/app-review-guidelines (fetch returned 403, not read)

**Registration and scopes**
- Register the app at developers.tiktok.com, add the Content Posting API product, and enable Direct Post if needed. Users authorize through Login Kit (OAuth).
- `video.publish` is the Direct Post scope; the app must be approved for it, and every target user must grant it.
- `video.upload` is the upload-to-inbox (draft) scope.

**Audit requirement (central constraint)**
- Before the audit: "All content posted by unaudited clients will be restricted to private viewing mode."
- Unaudited clients may post only with `privacy_level=SELF_ONLY`, and the target account must be private at posting time. A public post attempt fails at init with `unaudited_client_can_only_post_to_private_accounts`.
- Unaudited clients are capped at 5 posting users per 24 h.
- Content posted before the audit does not become public automatically. The owner has to make the account public, then set each post to "Everyone" by hand.
- Audit bar from the guidelines: "API Clients must not be limited to test applications and should be intended for a wide audience." **An internal tool that only posts to our own accounts may not meet this bar.** This is the biggest risk for TikTok Direct Post.
- What reviewers want: the official app-review page was not readable (403). From the guidelines and *(unverified)* community reports, expect to provide a working website with a privacy policy and ToS, a demo video of the full UX flow showing every required UX element below, a description of the use case, and, if using PULL_FROM_URL, a verified domain or URL prefix. In the audit application you also estimate usage, which sets your active-creator cap.

**Caps that apply even after the audit**
- A 24 h active-creator cap per client, set from your audit estimates (`reached_active_user_cap`).
- A per-creator cap of about 15 posts/day, shared across all Direct Post clients (`spam_risk_too_many_posts`).
- 6 requests/min per user access token on the init endpoints (`rate_limit_exceeded`, HTTP 429).

**Direct Post vs upload to inbox (draft)**
- Direct Post: `POST /v2/post/publish/video/init/` publishes straight to the profile. You must call Query Creator Info first. `post_info` fields:
  - `privacy_level`, which must be one of the creator's returned options
  - `title` (up to 2200 UTF-16 runes)
  - `disable_comment`, `disable_duet`, `disable_stitch`
  - `video_cover_timestamp_ms`
  - `brand_content_toggle`, `brand_organic_toggle`
  - `is_aigc`, an AI-generated content label
- Upload to inbox: an inbox init endpoint with scope `video.upload`. The only publish type is `INBOX_SHARE`. The creator gets an inbox notification and finishes editing and posting in the TikTok app. Same 6 req/min limit. The public visibility gate is skipped because a human posts the video.
- *(Unverified, from memory)*: there is a limit of about 5 pending inbox shares per user per 24 h (`spam_risk_too_many_pending_share`).
- Source options for both flows:
  - `FILE_UPLOAD`: chunked PUT to `upload_url`, which is valid for 1 h.
  - `PULL_FROM_URL`: needs verified domain or URL-prefix ownership, otherwise `url_ownership_unverified`.
- Status: poll the fetch-status endpoint, or use webhooks.

**Video specs**
- Container: MP4 (recommended), WebM, or MOV.
- Codec: H.264 (recommended), H.265, VP8, or VP9.
- Frame rate: 23-60 fps.
- Dimensions: each side 360-4096 px.
- File size: up to 4 GB.
- Duration: up to the creator's `max_video_post_duration_sec`, 3 min by default (some creators get 5 or 10 min).
- Chunks: 5-64 MB each (the final chunk can be up to 128 MB), 1-1000 chunks, uploaded sequentially. Files under 5 MB go up as a single chunk.

**Required UX (Direct Post)**
- Show the creator's nickname, using fresh creator info.
- Show an editable title. Preset hashtags must also be editable.
- Privacy dropdown built from `privacy_level_options`, with **no default**.
- Comment, Duet, and Stitch toggles, **none checked by default**, greyed out where the creator's settings disable them.
- Commercial content disclosure toggle, off by default, with "Your brand" and "Branded content" options. Branded content cannot be private.
- Consent text before the publish button: "By posting, you agree to TikTok's Music Usage Confirmation", plus the Branded Content Policy text when branded content is selected.
- Content preview.
- Send only after explicit user consent.
- Tell the user that processing "may take a few minutes".
- No added watermarks or promotional branding.

Taken together, these rules mean **a fully unattended "auto-post" with no human step is not compatible with Direct Post UX rules.** Every post needs a human to choose privacy and toggles and to give consent.

---

## 2. Instagram Reels via Instagram Graph API (Content Publishing)

Sources:
- https://developers.facebook.com/docs/instagram-platform/content-publishing (no date on page)
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
- https://developers.facebook.com/docs/graph-api/overview/access-levels

**Account requirements**
- The account must be an Instagram professional account (Business or Creator).
- The Facebook Login path also needs the account linked to a Facebook Page. If the Page requires Page Publishing Authorization, publishing is blocked until it is completed.

**Login paths and permissions**
- Business Login for Instagram (`graph.instagram.com`, IG user token): `instagram_business_basic` and `instagram_business_content_publish`. No Facebook Page needed.
- Facebook Login for Business (`graph.facebook.com`, Page token, resumable uploads at `rupload.facebook.com`): `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`, plus `ads_management`/`ads_read` when the user has a Business Manager role on the Page.

**App review and access levels**
- Standard Access is granted automatically, but "can only be requested from app users who have a role on the requesting app".
- Advanced Access requires App Review per permission (screencast plus use-case description) and Business Verification.
- **If we only publish to our own IG accounts and their owners hold roles on our app (admin/developer/tester), Standard Access may be enough without App Review.** We should confirm this works for content publishing in production.

**Publishing flow (Reels)**
1. `POST /<IG_ID>/media` with `media_type=REELS` and a public `video_url`, or with `upload_type=resumable` and an upload to rupload.
2. Poll `GET /<container>?fields=status_code` about once a minute, for up to 5 minutes.
3. `POST /<IG_ID>/media_publish` with `creation_id`.

Options: `share_to_feed`, `cover_url`/`thumb_offset`, `collaborators` (up to 3), `trial_params` (trial reels, `MANUAL` or `SS_PERFORMANCE` graduation), `audio_name`, and `location_id`. A published reel reports `media_type=VIDEO`; check `media_product_type` to confirm it is a reel.

**Publishing limit**
- 100 API-published posts per rolling 24 h. The carousel section of the same page says 50, and the docs don't reconcile the two; plan for 50.
- Check usage with `GET /<IG_ID>/content_publishing_limit`.

**Reels video specs**
- Container: MP4 or MOV, moov atom at the front, no edit lists.
- Video: H.264 or HEVC, progressive, closed GOP, 4:2:0, 23-60 fps, max width 1920 px, VBR at 25 Mbps max. Aspect ratio 0.01:1 to 10:1, 9:16 recommended.
- Audio: AAC, 48 kHz max, mono or stereo, 128 kbps.
- Duration 3 s to 15 min; file size 300 MB max.

---

## 3. YouTube Data API v3 (Shorts)

Sources:
- https://developers.google.com/youtube/v3/determine_quota_cost (last updated 2026-10-15)
- https://developers.google.com/youtube/v3/docs/videos/insert (last updated 2026-10-15)
- https://developers.google.com/youtube/v3/revision_history (entries 2020-07-28, 2025-12-04, 2026-06-01)
- https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits (last updated 2026-10-15)
- https://support.google.com/youtube/answer/15424877 (Shorts length/aspect)
- https://support.google.com/cloud/answer/13463073 (OAuth verification)

**Quota (recently changed)**
- 2025-12-04: the documented cost of an upload dropped from about 1600 units to about 100.
- 2026-06-01: `videos.insert` and `search.list` moved to their own quota buckets.
- The current audit page lists the defaults as 100 `videos.insert` calls/day, 100 `search.list` calls/day, and 10,000 units/day for everything else.
- Other costs: `videos.update` 50 units, `thumbnails.set` 50, `videos.list` 1. Quota resets at midnight Pacific.
- **About 100 uploads/day per project by default**, which is far more than we need.
- More quota requires the Audit and Quota Extension Form, i.e. a ToS compliance audit.

**Unverified projects and private lock (conflicting docs)**
- Historical rule (revision history, 2020-07-28): "All videos uploaded via the videos.insert endpoint from unverified API projects created after 28 July 2020 will be restricted to private viewing mode", and lifting that required an audit.
- The current `videos.insert` reference (2026-10-15) says: "Videos uploaded from unverified API projects are not restricted to private viewing mode."
- No revision-history entry announcing the reversal was found. Treat the current page as authoritative, but test it: upload as `public` (or `unlisted`) from a fresh project and confirm the result.

**OAuth verification**
- Upload scopes (any one): `youtube.upload`, `youtube`, `youtube.force-ssl`, or `youtubepartner`.
- Apps requesting sensitive or restricted scopes must complete Google OAuth app verification.
- *(Unverified, from memory)*: `youtube.upload` is classed as sensitive. An unverified app in "Testing" status is limited to 100 test users, and its refresh tokens expire after 7 days. For our own channels, a Testing-mode app would need re-consent weekly, so pursue verification or move to "In production" with verification.

**Shorts detection**
- No API flag exists for Shorts. YouTube classifies a video as a Short when it has a square or vertical aspect ratio and is **up to 3 minutes** long (uploads on or after 2024-10-15).
- A 9:16 clip of 15-30 s is automatically a Short. Adding `#Shorts` to the title or description is optional *(not required per the help page)*.
- Set `status.selfDeclaredMadeForKids` explicitly. Per the 2026-10-15 revision note, it is not overridden when omitted on update.

---

## Implications for our design

- **Build a human approve-and-post step into the pipeline.** TikTok Direct Post requires the creator to choose privacy and toggles and give consent each time. The cleanest compliant TikTok path is **upload to inbox (`video.upload`)**: the pipeline pushes the draft, and a human taps post in the TikTok app.
- **TikTok Direct Post audit is uncertain for an internal/own-accounts tool** ("intended for a wide audience"). Until audited, posts are SELF_ONLY on private accounts, which is useless for marketing. Plan for inbox as the default, and treat Direct Post as a stretch goal that needs a public-facing product, website, privacy policy, and demo video.
- **Instagram can be fully automated** for our own professional accounts. Use Business Login for Instagram (no Page needed), keep account owners as app roles so Standard Access may avoid App Review, and budget for 50 posts/24 h per account (far above need).
- **YouTube is the easiest**: about 100 uploads/day by default, and Shorts are detected automatically from the 9:16, ≤3 min format. The main work is the OAuth verification for the `youtube.upload` scope, to avoid 7-day token expiry.
- **One encode profile serves all three**: MP4, H.264 High, 1080x1920, 30 fps, AAC 48 kHz 128 kbps stereo, at most 25 Mbps, under 300 MB, moov atom at the front (`-movflags +faststart`), closed GOP.
- **Host clips on a domain we verify with TikTok** (for PULL_FROM_URL) and serve the same public URL to IG `video_url`. Otherwise use chunked FILE_UPLOAD and resumable upload.
- **Disclosures in metadata**: set TikTok `is_aigc` if clips are AI-generated or edited. Set `brand_organic_toggle` (promoting our own business) on TikTok, which forces the post public, and use the equivalent IG/YT paid-promotion or self-promo flags where relevant. Set YouTube `selfDeclaredMadeForKids` explicitly.
- **Per-platform rate guards** in the scheduler:
  - TikTok: 6 req/min per token, about 15 posts/day per creator.
  - IG: check `content_publishing_limit` before publishing.
  - YT: count `videos.insert` calls against the 100/day bucket.

## Open questions / couldn't verify

- TikTok app-review/audit page returned 403: the exact reviewer checklist, turnaround time, and whether a single-company internal tool can pass.
- The TikTok upload-to-inbox reference returned 403: the pending-share limit (I recall 5 per 24 h) and draft expiry are unconfirmed.
- YouTube unverified-project private lock: the current reference says lifted, but no dated announcement was found. Confirm with a test upload.
- Whether `youtube.upload` is currently "sensitive", and the exact Testing-mode limits (100 users, 7-day refresh tokens), were not confirmed on an official page.
- IG publishing limit: 100 vs 50 per 24 h is inconsistent within Meta's own page.
- Whether IG Standard Access (role users only) is sufficient for `instagram_business_content_publish` in production without App Review: likely, but not stated explicitly.
- TikTok AIGC labeling policy specifics for game-footage clips that are auto-edited but not generative.
