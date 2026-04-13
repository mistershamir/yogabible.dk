# Yoga Bible DK — Project Instructions

## Blog Writing Agent

When asked to write a blog/journal post:

1. **Discuss** topic, angle, audience, tone with user first
2. **Add entry** to `src/_data/journals.json` inside `"entries"` array with ALL fields:

```json
{
  "slug": "url-friendly-slug-in-danish", "date": "YYYY-MM-DD", "author": "Yoga Bible",
  "category": "yoga-styles|pranayama|philosophy|wellness|teacher-training",
  "tags": ["tag1", "tag2"], "featured": false, "gated": false,
  "image": "/assets/images/journal/slug-name.jpg",
  "readTime_da": "X min", "readTime_en": "X min",
  "title_da": "...", "title_en": "...",
  "excerpt_da": "...", "excerpt_en": "...",
  "content_da": "<p>...</p>", "content_en": "<p>...</p>"
}
```

**HTML:** `<h2>` main sections, `<h3>` subsections, `<p>` with `<strong>`/`<em>`, `<ul>`/`<ol>`, `<blockquote>`, `<a>`. Auto drop cap on first paragraph. Use h2 every 2-3 paragraphs, 1+ blockquote per post, CTA at end. Short paragraphs (3-4 sentences).

**Bilingual:** Danish is PRIMARY (natural, not translated). English also natural. Same structure in both.

**SEO:** Slug: Danish lowercase hyphens. Title <60 chars with keyword. Excerpt 150-160 chars. 3-5 tags. Categories: `yoga-styles`, `pranayama`, `philosophy`, `wellness`, `teacher-training`.

**After writing:** Build `npx @11ty/eleventy`, commit, push. Default image: `/assets/images/og/og-1200x630.png`. Custom: `src/assets/images/journal/{slug}.jpg` (1200x630px).

---

## Bilingual i18n System (MANDATORY)

ALL pages must exist in both Danish + English. Danish is primary. English lives under `/en/`.

### Page Pattern (no exceptions)

1. `src/_data/i18n/{page}.json` — `{"da": {...}, "en": {...}}`
2. `src/_includes/pages/{page}.njk` — `{% set t = i18n.{page}[lang or "da"] %}` + `{{ t.key }}`
3. `src/{page}.njk` — thin DA wrapper (lang: da)
4. `src/en/{page}.njk` — thin EN wrapper (lang: en, permalink: /en/{slug}/)

Auto-loaded: `src/_data/i18n.js` loads all JSON. `src/en/en.11tydata.json` sets `lang: "en"`.

### Rules

- **Always update JSON** — both `da` and `en` keys
- **Never hardcode text** — use `{{ t.key }}` or `{{ t.key | safe }}`
- **Language-aware links:** `{% set lp = "/en" if lang == "en" else "" %}` then `{{ lp }}/kontakt`
- **Footer translations:** `src/_data/i18n/common.json`
- **New pages:** Create i18n JSON + shared template + DA wrapper + EN wrapper, then build to verify

---

## Bilingual Email & SMS System (MANDATORY)

ALL emails/SMS MUST have both DA and EN versions. Never send generic fallback to EN leads.

- **Primary provider:** Resend (`resend-service.js`). Gmail SMTP only for one-off bulk sends.
- **i18n data:** `netlify/functions/shared/lead-email-i18n.js` — `SHARED`, `PROGRAMS`, `SCHEDULE_PATHS`, `PROGRAM_PAGES`
- **Email builders:** `netlify/functions/shared/lead-emails.js` — accept `lang` parameter
- **Language detection:** `lead.lang` from `/en/` path detection or Meta form `lang` field
- **Schedule URLs:** EN → `/en/schedule/*`, DA → `/tidsplan/*`. Both use `?tid=&tok=` tokens.

### Rules

1. Always update both languages in `lead-email-i18n.js`
2. Never send generic email to EN leads when program-specific exists in DA
3. Schedule CTAs: use `scheduleUrl(programKey, lang, tokenData)`
4. New programs: add to `PROGRAMS` in i18n + builder in `lead-emails.js` + routing in `sendWelcomeEmail`
5. SMS must also be bilingual — check `shared/sms-service.js`

---

## Nurture Sequence System (MANDATORY)

Multi-layered email/SMS nurture on Firestore + Netlify Functions. All bilingual (DA + EN).

### Architecture — 3 Parallel Layers

| Layer | Audience | Cadence |
|-------|----------|---------|
| **Broadcast Nurture** | ALL leads | 6 steps, ~28 days |
| **New Lead Onboarding** | Undecided leads | 5 steps, ~12 days |
| **Program-Specific Conversion** | Matched leads | 2-4 steps |

Plus: **Quick Follow-up** (2.5h after signup) and **Educational/Lifestyle Nurture** (planned, not built).

### Key Files

| File | Purpose |
|------|---------|
| `netlify/functions/process-sequences.js` | Cron processor (`*/30 * * * *`) |
| `netlify/functions/shared/sequence-trigger.js` | Auto-enrollment on form submission |
| `netlify/functions/audit-sequences.js` | Firestore state audit (GET) |

### Sequence IDs in Firestore

| Sequence | Firestore ID |
|----------|-------------|
| YTT Broadcast Nurture — 2026 | `Ma2caW2hiQqtkPFesK27` |
| YTT Quick Follow-up | `Ue0CYOsPJlnj5SF9PtA0` |
| YTT Onboarding — 2026 | `Un1xmmriIpUyy2Kui97N` |
| April 4W Intensive | `ZwvSVLsqRZcIv8C0IG0y` |
| 8W Semi-Intensive May–Jun | `uDST1Haj1dMyQy0Qifhu` |
| 18W Flexible Aug–Dec | `ab2dSOrmaQnneUyRojCf` |
| July Vinyasa Plus (DK) | `Yoq6RCVqTYlF10OPmkSw` |
| July Vinyasa Plus (Intl) | `{PENDING_ID}` |

### System Behavior

- **Language:** `lead.lang || lead.meta_lang || lead.language || 'da'`. DA gets `email_subject`/`email_body`, others get `_en` variants.
- **Form language detection:** `modal-200ytt.js` and `modal-300ytt.js` append `lang` field from path detection (`/en/` → `'en'`).
- **Auto-deactivation:** `enrollment_closes` date field stops new enrollments. Existing leads finish their journey.
- **July trigger:** Uses `"4-week"` (not `"4-week-jul"`) to catch generic 4-week leads after April closes.
- **48h throttle:** If last email <48h ago, postpone by 24h. Emails bumped, never dropped.
- **Exit conditions:** `["Converted", "Existing Applicant", "Unsubscribed", "Lost", "Closed", "Archived"]`. Keeps: `Not too keen`, `On Hold`, `Interested In Next Round`.
- **4-week-jul country split:** DK leads → standard flow (Broadcast + Onboarding + July DK). Non-DK → July International Conversion (8 emails, EN+DE+country blocks). Uses `detectLeadCountry()` from `country-detect.js`.

### Content Rules (MANDATORY for All Emails)

1. **Never mention course language.** YTT is taught in English but NEVER say this in marketing.
2. **Never mention refunds.** Prep Phase is non-refundable if student cancels.
3. **Email tone:** Warm, personal, from Shamir. Plain text with orange links.
4. **EN URLs use `/en/` prefix.**
5. **Prep Phase:** "3.750 kr. / 3,750 DKK — deducted from full price." No class count mention.
6. **DA ≠ literal EN translation** — DA is practical/local, EN is aspirational/international.

**Shamir's signature:** `Shamir, Kursusdirektør · Yoga Bible | +45 53 88 12 09 | Torvegade 66, 1400 København K`

### New Sequence Checklist

1. Create in Firestore `sequences` with `name`, `steps[]` (delay_minutes, email_subject/body DA+EN, channel), `exit_conditions`, optional `enrollment_closes`
2. Add trigger in `sequence-trigger.js`
3. Verify EN URLs use `/en/`
4. Run `audit-sequences` to verify
5. Scan for forbidden content (language mentions, refund promises)

---

## Lead Behavior Tracking (MANDATORY)

ALL emails MUST include tracking. Three layers:

| Layer | Mechanism | Firestore Field |
|-------|-----------|-----------------|
| Schedule Tracking | `?tid=&tok=` HMAC params → `schedule-visit.js` | `leads/{id}.schedule_engagement` |
| Email Engagement | Pixel + link wrapping → `email-track.js` | `leads/{id}.email_engagement` |
| Website Behavior | `yb_lid` cookie → `site-track.js` → `site-visit.js` | `leads/{id}.site_engagement` |

Re-engagement: 7+ days inactive → returns → `re_engaged: true`.

### Rules for New Email Features

1. ALL emails MUST call `prepareTrackedEmail(html, leadId, sourceTag)` as LAST step before sending
2. Source tags: `seq:SEQUENCE_ID:STEP`, `welcome:PROGRAM_KEY`, `campaign:CAMPAIGN_ID`
3. Schedule URLs MUST be tokenized — `injectScheduleTokens(html, leadId, email)`
4. Processing order: (1) template vars → (2) schedule tokens → (3) email tracking
5. Never wrap unsubscribe links, pixel URLs, or already-wrapped links
6. Sequence processor auto-injects both schedule tokens and email tracking — no manual setup for sequences

### Rules for New Pages

- `site-track.js` loaded globally via `base.njk` — no setup needed
- New page categories: add to `PAGE_INTERESTS` map in `site-visit.js`
- CTAs auto-tracked if using `.yb-btn`, `.yb-btn--primary`, `.yb-hero__cta`, `[data-checkout-product]`

### Key Files

`shared/email-tracking.js` (prepareTrackedEmail helper), `email-track.js` (pixel + click endpoint), `schedule-visit.js`, `site-visit.js`, `src/js/schedule-track.js`, `src/js/site-track.js`

---

## Content Rules (MANDATORY)

- **All YTT courses are taught in English.** Never mention the language of instruction in marketing emails, ads, or content. Only discuss if a lead asks directly.

---

## Architecture Reference

- **Framework:** Eleventy v3.1.2, Nunjucks templates
- **Data:** `src/_data/journals.json` (wrapped: `{"entries": [...]}`)
- **CSS:** Split across 4 files (see CSS Architecture below)
- **CMS:** Decap CMS at `/admin/` with Netlify Identity
- **i18n:** Build-time JSON in `src/_data/i18n/`, path-based `/en/` prefix
- **Deploy:** Netlify from `main` branch
- **Design System:** `src/samples.njk` → `/samples/`
- **Profile/Store:** `src/js/profile.js`
- **Hot Yoga CPH:** `hot-yoga-cph/public/js/profile.js` + `hot-yoga-cph/public/css/profile.css`
- **Apps Script:** `apps-script/` — legacy (being replaced by Netlify + Firestore)

### CSS Architecture (MANDATORY)

Split into 4 files. Put styles in the correct file.

| File | Loaded On | Prefix(es) |
|------|-----------|------------|
| `src/css/main.css` | Every page | Global (header, footer, hero, buttons, forms, cards, `.ycf-` checkout flow) |
| `src/css/journal.css` | Journal only (`includeJournal: true`) | `.yj-` |
| `src/css/store.css` | Store only (`includeStore: true`) | `.yb-store__` |
| `src/css/admin-panel.css` | Admin only (`includeAdmin: true`) | `.yb-admin__`, `.yb-kb__`, `.yb-lead__`, `.yb-billing__`, `.yb-doc-browser__`, `.yb-seq__` |

Front matter flags checked in `src/_includes/head.njk`. New page-specific styles (500+ lines) → consider a new split file. Add flags to both DA and EN wrappers.

### Netlify Functions

All in `netlify/functions/`. Shared code in `netlify/functions/shared/`. Auth: Firebase ID token via `Authorization: Bearer <token>`, `requireAuth(event, ['admin'])`. Roles in Firestore `users/{uid}.role`.

**Categories:** Lead & CRM (`lead`, `leads`, `facebook-leads-webhook`, `facebook-leads-backfill`, `send-email`, `send-sms`, `send-acceptance-email`, `unsubscribe`, `sms-webhook`, `sms-conversations`, `campaign-log`), Applications (`apply`, `applications`, `activate-applicant`, `status`), Appointments (`appointments`, `appointment-book`, `appointment-reminders`), MindBody (`mb-client`, `mb-classes`, `mb-class-descriptions`, `mb-services`, `mb-book`, `mb-checkout`, `mb-contracts`, `mb-contract-manage`, `mb-purchases`, `mb-return-sale`, `mb-client-services`, `mb-giftcards`, `mb-visits`, `mb-waitlist`, `mb-waiver`, `mb-staff`, `mb-site`, `mb-sync`), Admin (`catalog-admin`, `economic-admin`, `live-admin`, `knowledge-admin`, `email-templates`, `bunny-browser`), Tracking (`email-track`, `schedule-visit`, `site-visit`, `backfill-schedule-tokens`), Live (`livekit-token`, `mux-stream`, `mux-webhook`, `ai-process-recording-background`, `ai-backfill`, `serve-vtt`), Sequences (`process-sequences`, `audit-sequences`, `fix-sequences`, `fix-english-urls`, `scan-sequence-language`), Other (`catalog`, `catalog-seed`, `careers`, `member-documents`, `schedule-token`, `auth-token`, `health`, `meta-capi`, `instagram-webhook`, `instagram-send`, `instagram-token-refresh`).

### Client-Side JS

All in `src/js/`. Standalone IIFEs, no bundler.

**Core:** `header.js`, `footer.js`, `main.js`, `cookies.js`, `tracking.js`, `firebase-auth.js`, `roles-permissions.js`
**Store:** `profile.js` (main store logic), `checkout-flow.js` (multi-step modal), `ytt-funnel.js`, `mindbody.js`
**Pages:** `journal.js`, `glossary.js`, `live.js`, `course.js`, `course-viewer.js`, `member.js`, `member-courses.js`, `member-materials.js`, `schedule-track.js`, `site-track.js`, `appointment-booking.js`, `om200.js`, `p300.js`, `modal-200ytt.js`, `modal-300ytt.js`, `link.js`, `cb.js`, `ytt-schedule.js`, `vibroyoga.js`, `photo-booking.js`
**Admin:** `lead-admin.js`, `live-admin.js`, `billing-admin.js`, `catalog-admin.js`, `course-admin.js`, `doc-admin.js`, `knowledge-admin.js`, `careers-admin.js`, `appointments-admin.js`, `campaign-wizard.js`, `sequences-admin.js`, `nurture-admin.js`

### Admin Panel

At `/admin/` (`src/admin-panel.njk` → `src/_includes/pages/admin.njk`). Firebase auth-gated. i18n in `src/_data/i18n/course-admin.json`. Tabs: Courses, Users, Analytics, Leads, Applications, Careers, Appointments, Catalog, Documents, Live, Billing, Knowledge. Partials: `src/_includes/partials/admin-{name}-panel.njk`.

### Environment Variables

**Netlify:** `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `MB_API_KEY`, `MB_SITE_ID`, `MB_SOURCE_NAME`, `MB_SOURCE_PASSWORD`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GATEWAYAPI_TOKEN`, `ECONOMIC_APP_SECRET`, `ECONOMIC_AGREEMENT_TOKEN`, `UNSUBSCRIBE_SECRET`, `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `META_ACCESS_TOKEN`, `META_PIXEL_ID`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_VERIFY_TOKEN`, `BUNNY_STORAGE_API_KEY`, `BUNNY_CDN_HOST` (`yogabible.b-cdn.net`), `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_LIBRARY_ID` (`627306`), `BUNNY_STREAM_CDN_HOST` (`vz-4f2e2677-3b6.b-cdn.net`), `AI_INTERNAL_SECRET`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM`, `DEEPGRAM_API_KEY`.

**Lead Agent (`lead-agent/.env`):** `ANTHROPIC_API_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GATEWAYAPI_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID`, `AGENT_MODEL` (default: `claude-sonnet-4-6`), `SITE_URL`.

---

## Meta Ads CLI

```bash
python3 scripts/meta-ads-cli.py <command> [args...]
```

Reads `META_ACCESS_TOKEN` from `ads-agent/.env`.

| Command | Description |
|---------|-------------|
| `accounts` | List ad accounts |
| `campaigns [brand] [--status=X]` | List campaigns (`yb`/`hyc`) |
| `insights <campaign_id> [days]` | Campaign performance (spend, leads, CTR, CPL) |
| `account-insights [brand] [days]` | Account-level summary |
| `adsets <campaign_id>` | Ad sets + targeting |
| `adset-insights <adset_id> [days]` | Ad set performance |
| `ads <adset_id>` | Ads in ad set |
| `ad-insights <ad_id> [days]` | Individual ad performance |
| `creative <ad_id>` | Creative details (text, headline, CTA, link, image) |
| `audiences [brand]` | Custom audiences |
| `leadforms [brand]` | Instant forms |
| `pause/resume/archive/delete <id>` | Status changes |
| `budget <id> <daily_dkk>` | Update daily budget (DKK) |
| `lifetime-budget <id> <amount_dkk>` | Update lifetime budget |
| `duplicate <id>` | Duplicate (created PAUSED) |
| `update-ad-text <ad_id> <field> <value>` | Update creative text (primary_text, headline, description, link, cta) |
| `create-campaign <brand> <name> <objective> <budget>` | New campaign (PAUSED) |
| `create-adset <campaign_id> <name> <budget> <targeting.json>` | New ad set |
| `create-ad <adset_id> <name> <creative.json>` | New ad |
| `create-audience <brand> <name> <desc>` | New audience |
| `create-leadform <brand> <form.json>` | New instant form |

**Accounts:** Yoga Bible `act_1137462911884203`, Hot Yoga CPH `act_518096093802228`. All budgets in DKK. Created entities default to PAUSED. Creatives can't be edited in-place — `update-ad-text` creates new creative and swaps it.

---

## AI Lead Management Agent

Python agent managing YTT leads via Telegram. Lives in `lead-agent/`, runs 24/7 on Mac Mini.

**Core files:** `agent.py` (Telegram bot + APScheduler + Firestore listener), `knowledge.py` (system prompt builder), `scheduler.py` (drip sequences), `monitor.py` (uptime). Tools in `lead-agent/tools/` (firestore, email, sms, telegram).

**Flow:** Firestore listener → new lead → Telegram notifies Shamir → drip scheduler sends sequences → Shamir chats via Telegram → Claude API processes commands.

**Dynamic knowledge:** Firestore `agent_knowledge` collection, managed via `/admin/` → Knowledge tab → 3 brand tabs (YB, HYC, Vibro).

**Running:** `python agent.py` (Telegram), `--cli` (testing), `--daemon` (launchd). Auto-deploy daemon checks GitHub every 5 min. Daemon plist: `com.yogabible.lead-agent`.

**Firestore collections:** `leads`, `lead_drip_sequences`, `email_log`, `appointments`, `agent_knowledge`.

---

## SEO/AEO Monitoring Agent

Lives in `seo-agent/`. APScheduler daemon with weekly full reports (Mon 8am) and daily quick checks (7am, silent unless issues). Monitors 14 key pages, validates pricing (23.750 DKK), tracks 10 target keywords.

Run: `python agent.py` (daemon) or `--once` (one-time report).

---

## Live Streaming System

Two modes: one-way broadcast (Mux HLS) + interactive (LiveKit video call). Stream types: `broadcast`, `interactive`, `panel`, `google-meet`.

**Key files:** `src/js/live.js` (viewer), `src/js/live-admin.js` (admin/Teacher Studio), `livekit-token.js`, `mux-stream.js`, `mux-webhook.js`.

### AI Recording Pipeline

Mux webhook → `ai-process-recording-background` → Deepgram Nova-2 transcription → VTT subtitles → Mux subtitle upload → Claude summary + quiz → Firestore.

Status flow: `preparing_audio` → `transcribing` → `uploading_subtitles` → `generating_summary` → `complete`.

**Critical implementation details (do NOT change):**
- **Word-level fallback:** Deepgram can return empty utterances for 3h+ recordings. `buildUtterancesFromWords()` builds synthetic utterances from word-level timestamps in ~10s chunks. Do NOT remove this fallback.
- **VTT URL:** Must use `https://yogabible.dk` (hardcoded), NOT `process.env.URL` (resolves to `www.yogabible.dk` → 301 redirect → Mux silently fails).
- **Sequential retranscribe:** Process one session at a time. Deepgram returns 504 on parallel long recordings.

**Retranscribe:** `curl "https://yogabible.dk/.netlify/functions/ai-backfill?retranscribe=SESSION_ID&secret=AI_INTERNAL_SECRET"`

---

## Store & Checkout System

### Terminology (MANDATORY)

YTT initial payment = **"Preparation Phase" / "Forberedelsesfasen"** — NEVER "deposit" or "depositum" in user-facing text. Code may use `deposits`/`isDeposit` internally.

### Store Catalog

Lives in `src/js/profile.js` as `storeCatalog` with age-bracket pricing (`over30`/`under30`). Categories: `daily` (memberships, timebased, clips, trials, tourist), `teacher` (deposits), `courses` (individual, bundle), `workshops`, `private`.

### Checkout Flow Modal

4-step popup: Login → Register → Checkout → Success. Files: `modal-checkout-flow.njk`, `checkout-flow.js`, `ytt-funnel.js`. CSS prefix: `ycf-` (lives in `main.css`).

- CTA trigger: `data-checkout-product="100121"` or `startCheckoutFunnel('100121')`
- MB client created immediately after auth (not at payment) — triggers MB welcome email
- Stored card detection via `mb-client?action=storedCard`
- New cards always saved (`saveCard: true`)
- URL param: `?product=100078` auto-opens checkout
- Bilingual: uses `data-yj-da`/`data-yj-en` pattern + `t(da, en)` helper

### Active Products

| Product | ID | Price |
|---------|----|-------|
| 18W Flexible (Mar–Jun 2026) | 100078 | 3750 DKK |
| 4W Intensive (Apr 2026) | 100121 | 3750 DKK |
| 4W Vinyasa Plus (Jul 2026) | 100211 | 3750 DKK |
| 8W Semi-Intensive (May–Jun 2026) | 100209 | 3750 DKK |
| 18W Flexible (Aug–Dec 2026) | 100210 | 3750 DKK |
| 300h Advanced | 100212 | 5750 DKK |
| Inversions / Splits / Backbends | 100145 / 100150 / 100140 | 2300 DKK each |
| Course Bundles (2-course) | 119, 120, 121 | combo pricing |
| All-In Bundle (3-course + free pass) | 127 | combo pricing |
| Workshop pass | 100075 | 975 DKK |

**`PRODUCTS` in `checkout-flow.js` must stay in sync with `storeCatalog` in `profile.js`.**

**WARNING:** `ytt-funnel.js` line 33 contains test product `100203` — do NOT use in production.

### Waiver System

3-tier check: localStorage (instant) → Firestore `consents` (async) → MindBody API (async). `hideCheckoutWaiverIfSigned()` auto-hides waiver in open checkout when confirmed signed.

### Dual-Site Parity

All store/checkout changes → **both** sites: YB (`src/js/profile.js` + `src/css/main.css`) and HYC (`hot-yoga-cph/public/js/profile.js` + `hot-yoga-cph/public/css/profile.css`).

### Purchase Funnel

Stages: `cta_click` → `auth_complete` → `profile_complete` → `checkout_opened` → `purchased` (or `checkout_abandoned`). Tracked in `src/js/ytt-funnel.js` + Firestore `lead_funnel` collection.

---

## Bunny CDN (MANDATORY)

All media on Bunny CDN (`yogabible.b-cdn.net`). Storage zone: `yogabible`. All paths under `yoga-bible-DK/`. API keys via `BUNNY_STORAGE_API_KEY` and `BUNNY_ACCOUNT_API_KEY` env vars.

### Template Usage

```nunjucks
{{ "yoga-bible-DK/homepage/hero.jpg" | cloudimg }}              {# URL #}
{{ "yoga-bible-DK/homepage/hero.jpg" | cloudimg("w_800,h_600") }} {# resized #}
{{ "yoga-bible-DK/homepage/hero-loop.mp4" | cloudvid }}          {# video URL #}
{% cldimg "yoga-bible-DK/homepage/hero.jpg", "Alt", "w_800", "800", "600" %}  {# <img> tag #}
{% cldvid "yoga-bible-DK/courses/reel.mp4", "yoga-bible-DK/courses/poster.jpg", "" %}
```

Bunny Optimizer auto-serves WebP/AVIF, smart compression, auto-resize. Optional params: `?width=800`, `?height=600`, `?quality=85`.

### New Page Checklist

1. Upload assets to Bunny Storage (folders auto-created on upload)
2. Create page files (i18n JSON, template, DA/EN wrappers)
3. Use `cloudimg`/`cldimg` for images, `cloudvid`/`cldvid` for videos
4. Add placeholder: `{# BUNNY: yoga-bible-DK/pagename/hero.jpg — 1920x900 #}`
5. Build: `npx @11ty/eleventy`

**Naming:** lowercase, hyphens, match page slug. Nest sub-sections under parent folder.

### Bunny Stream (Video Hosting)

Library ID: `627306`. CDN: `vz-4f2e2677-3b6.b-cdn.net`. Uploads use `tus-js-client` (do NOT replace with custom XHR — causes 405 errors). Webhook: `bunny-stream-webhook.js` updates Firestore `social_media` collection.

Video URLs: `https://vz-4f2e2677-3b6.b-cdn.net/{videoId}/thumbnail.jpg` (also `/playlist.m3u8`, `/play_720p.mp4`, `/preview.webp`).

---

## Unified Design System (MANDATORY)

Use ONLY approved components from `/samples/` (`src/samples.njk`). Never invent new styles.

### Brand Identity

| Token | Value |
|-------|-------|
| Font | Abacaxi Latin (400/700). Fallback: Helvetica Neue, Arial, system-ui, sans-serif |
| Primary | `#f75c03` (Brand Orange) |
| Brand Dark / Light | `#d94f02` / `#ff9966` |
| Hot Yoga CPH | `#3f99a5` (HYC content ONLY) |
| Black | `#0F0F0F` |
| Muted | `#6F6A66` |
| Border | `#E8E4E0` |
| Light BG / Warm White | `#F5F3F0` / `#FFFCF9` |

### Key Components (see `/samples/` for full reference)

**3 Buttons:** Primary (orange), Secondary (black), Outline, Ghost, Outline-Light. Shimmer + Gradient Border for special.
**4 Cards:** Lift, Border, Glow hover. 3D Tilt for special offers ONLY. Testimonials: orange stroke.
**5 Hover:** Lift, Glow, Background, Invert, Underline, Fill Up.
**6 Animations:** Pulse, Bounce, Breathe — use sparingly.
**7 Scroll-Triggered:** Fade Up, Slide Left/Right, Scale In, Staggered Children.
**10 Backgrounds:** Solid Brand, Solid Dark, Gradient H, Animated.
**11 Layouts:** Split Dark/Light, Split Brand/Light, Asymmetric, Overlap.
**14 Forms:** Orange-stroke rounded inputs (12px radius). Two-column grid. Label above field.
**15 Accordions:** Separate rounded items (light gray bg), orange circle + icon. NOT connected blocks.
**18 Quotes:** Default, Dark Cinematic, Brand Gradient, Side Bar, Centered.
**25 Reviews:** Orange stroke cards, 3-column, stars + quote + avatar.
**26 Pricing:** Accordion, Side-by-Side Cards, Comparison Table (orange header).
**29 Hero Sections:** Centered Clean, Split with Image, Dark Cinematic, Asymmetric with Stats Bar.
**30 Scroll-Draw Paths:** SVG vine/branch paths. `fill="none"`, `preserveAspectRatio="xMidYMid meet"`.

### Design Rules

1. Never invent new component styles — reference `/samples/`
2. Forms: orange-stroke inputs, 12px border-radius
3. Accordions: separate rounded items, not connected blocks
4. 3D tilt: special offers only
5. Animations (Pulse/Bounce/Breathe): use sparingly
6. HYC color `#3f99a5`: only for Hot Yoga CPH content
7. Hero sections: use one of 4 approved patterns
8. Review cards: orange stroke border (`1.5px solid var(--yb-brand)`)
9. Pricing tables: orange header bar
10. Scroll-draw vines: brand element for landing pages

---

## Social Media Platform Credentials

**Meta:** App ID `911693838016427`, FB Page ID `878172732056415`, IG Account ID `17841474697451627`. Page token (never expires) in Firestore `social_accounts`. Permissions include `instagram_content_publish`, `pages_manage_posts`, `ads_management`, `leads_retrieval`.

**TikTok:** Client Key `aw0ak2eupqflz21x`, Org ID `7621584075303699477`. Status: pending review. Verified domains: `yogabible.dk`, `yogabible.com`.

**LinkedIn:** Client ID `78eu35dic8g09s`, Org ID `109163211`. Token expires ~60 days. Redirect URI: `https://yogabible.dk/admin/`.

**YouTube:** OAuth Client ID `969617587598-u23upn58qi3l3i1dgqm4en1th9kel602.apps.googleusercontent.com`. Project: `yogabiblenetlifyproject`. Consent screen: internal (yogabible.dk org).

**Pinterest:** App ID `1556643`. Trial access pending. Domain verify meta tag in `head.njk`.

All managed via `/admin/` → Social → Accounts tab.

---

## Scripts & Automation

**Git Auto-Sync** (`scripts/git-auto-sync.sh`): Bidirectional sync local↔GitHub every 5 min via launchd. Handles iCloud `.git` corruption, lock files, retry with backoff. Config: `scripts/com.yogabible.git-sync.plist`.

---

*Detailed reference for archived sections (sequence content tables, full Firestore schemas, checkout flow step-by-step, Bunny CDN folder tree, schedule conflict finder, full agent tools list) → see `docs/CLAUDE-ARCHIVE.md`*
