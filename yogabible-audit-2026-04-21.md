# Yoga Bible DK — Full Codebase Audit

**Date:** April 21, 2026  
**Scope:** Complete read-only audit of yogabible.dk  
**Total Files:** ~1,138 (excluding node_modules, .git, _site)

---

## 1. Project Structure

```
yogabible.dk-1/
├── src/                          # Eleventy source
│   ├── css/          (11 files)  # Split CSS architecture
│   ├── js/           (47+ files) # Client-side IIFE modules
│   ├── _data/        (66 files)  # JSON data + i18n + glossary
│   ├── _includes/    (83 files)  # Layouts, partials, pages, modals
│   ├── en/           (40+ files) # English page wrappers
│   ├── assets/                   # Static assets (images, fonts)
│   └── *.njk         (92 files)  # Danish page wrappers
├── netlify/functions/            # Serverless functions
│   ├── *.js          (111 files) # HTTP + background + scheduled
│   └── shared/       (21 files)  # Reusable utilities
├── hot-yoga-cph/                 # Separate HYC member portal
│   ├── public/js/    (7 files)   # Mirrored store/auth JS
│   ├── public/css/               # HYC-branded styles
│   └── netlify.toml              # Shares ../netlify/functions
├── lead-agent/                   # Python AI lead agent (Telegram)
├── seo-agent/                    # Python SEO monitor daemon
├── ads-agent/                    # Python Meta Ads CLI
├── scripts/          (19 files)  # Build, migration, automation
├── apps-script/                  # Legacy Google Sheets (archived)
├── docs/                         # Architecture docs
├── original/                     # Archived Squarespace HTML
├── Brand Assets/                 # Visual branding
├── package.json
├── netlify.toml
├── .eleventy.js
└── CLAUDE.md                     # Project instructions (~25 KB)
```

---

## 2. Stack & Dependencies

### Core Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| SSG/Framework | Eleventy (11ty) | 3.1.2 |
| Hosting | Netlify | Node 20 |
| Database | Firebase/Firestore | firebase-admin 13.6.1 |
| Email (Primary) | Resend | via RESEND_API_KEY |
| Email (Fallback) | Gmail SMTP | nodemailer 8.0.1 |
| SMS | GatewayAPI EU | via GATEWAYAPI_TOKEN |
| Payments/Booking | MindBody v6 API | 20 endpoints |
| Video Streaming | Mux (HLS broadcast) | via MUX_TOKEN_ID/SECRET |
| Interactive Video | LiveKit | via LIVEKIT_API_KEY/SECRET |
| Transcription | Deepgram Nova-2 | via DEEPGRAM_API_KEY |
| AI | Anthropic Claude | via ANTHROPIC_API_KEY |
| CDN/Images | Bunny CDN | yogabible.b-cdn.net |
| Video Hosting | Bunny Stream | Library 627306 |
| Translation | Build-time i18n (JSON) | Path-based /en/ |
| Font | Abacaxi Latin | 400/700 weights |
| Analytics | GTM + Meta Pixel | via site.json IDs |
| Accounting | e-conomic (Danish ERP) | via ECONOMIC_* vars |
| Template Engine | Nunjucks | via Eleventy |
| Markdown | markdown-it | 14.1.0 |
| Image Optimization | @11ty/eleventy-img | 6.0.4 |

### npm Dependencies (package.json)

**Production:**

| Package | Version | Purpose |
|---------|---------|---------|
| @11ty/eleventy-img | 6.0.4 | Responsive image generation (WebP/AVIF) |
| firebase-admin | 13.6.1 | Firestore backend + Firebase Auth |
| markdown-it | 14.1.0 | CMS content rendering |
| nodemailer | 8.0.1 | Gmail SMTP fallback email sending |

**Development:**

| Package | Version | Purpose |
|---------|---------|---------|
| @11ty/eleventy | 3.1.2 | Static site generator |
| cssnano | 7.1.4 | CSS minification (post-build) |
| html-minifier-terser | 7.2.0 | HTML minification |
| postcss | 8.5.9 | CSS processing pipeline |
| terser | 5.46.0 | JavaScript minification |

**Hot Yoga CPH:** googleapis 171.4.0

**Python Agents:**
- lead-agent: anthropic, google-cloud-firestore, apscheduler, aiohttp, python-telegram-bot
- seo-agent: python-dotenv, apscheduler, google-api-python-client, anthropic, pytrends
- ads-agent: anthropic, python-dotenv, python-telegram-bot

### Environment Variables (58 unique)

**Firebase (4):** FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

**MindBody (4):** MB_API_KEY, MB_SITE_ID, MB_SOURCE_NAME, MB_SOURCE_PASSWORD

**Email (5):** RESEND_API_KEY, RESEND_FROM, GMAIL_USER, GMAIL_APP_PASSWORD

**SMS (2):** GATEWAYAPI_TOKEN

**Meta/Social (12):** META_ACCESS_TOKEN, META_PIXEL_ID, INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_VERIFY_TOKEN, plus LinkedIn/TikTok vars

**Video/Streaming (7):** MUX_TOKEN_ID, MUX_TOKEN_SECRET, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL

**CDN (8):** BUNNY_STORAGE_API_KEY, BUNNY_CDN_HOST, BUNNY_STREAM_API_KEY, BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_CDN_HOST, BUNNY_ACCOUNT_API_KEY

**AI (2):** ANTHROPIC_API_KEY, DEEPGRAM_API_KEY

**Accounting (2):** ECONOMIC_APP_SECRET, ECONOMIC_AGREEMENT_TOKEN

**Security (2):** UNSUBSCRIBE_SECRET, AI_INTERNAL_SECRET

---

## 3. Netlify Functions Inventory (111 total)

### By Category

| Category | Count | Key Files |
|----------|-------|-----------|
| Lead & CRM | 9 | lead.js (852 LOC), leads.js, facebook-leads-webhook.js (655), audit-leads.js (959) |
| Email & SMS | 9 | send-email.js (318), email-track.js (371), resend-webhook.js (266), sms-webhook.js |
| Sequences & Nurture | 6 | process-sequences.js (cron */30), audit-sequences.js, fix-sequences.js |
| Applications | 3 | apply.js, applications.js, activate-applicant.js |
| Appointments | 3 | appointments.js, appointment-book.js, appointment-reminders.js (cron) |
| MindBody | 20 | mb-client.js, mb-book.js, mb-checkout.js, mb-contracts.js, etc. |
| Live Streaming | 5 | livekit-token.js (32 KB), mux-stream.js, mux-webhook.js (35 KB), live-room-cleanup.js (cron */5) |
| AI & Recording | 5 | ai-process-recording-background.js (46 KB), ai-backfill.js (59 KB), serve-vtt.js |
| Social Media | 28 | social-schedule.js, social-ai.js (1118), social-posts.js, social-analytics.js, etc. |
| Admin & Catalog | 9 | catalog-admin.js, economic-admin.js, knowledge-admin.js, bunny-browser.js |
| Auth & OAuth | 5 | auth-token.js, oauth-initiate.js, oauth-callback.js, instagram-token-refresh.js |
| Tracking | 4 | email-track.js, schedule-visit.js, site-visit.js, anon-visit.js |
| Webhooks | 5 | instagram-webhook.js, bunny-stream-webhook.js, deepgram-webhook.js, sms-webhook.js |

### Auth Method Distribution

| Method | Count | % |
|--------|-------|---|
| Public (no auth) | 45 | 41% |
| requireAuth (Firebase token) | 38 | 35% |
| Internal secret (X-Internal-Secret) | 16 | 15% |
| Webhook verification | 12 | 9% |

### Scheduled Functions (18 cron jobs in netlify.toml)

| Function | Schedule | Purpose |
|----------|----------|---------|
| process-sequences | */30 * * * * | Nurture drip processor |
| live-room-cleanup | */5 * * * * | Orphaned LiveKit rooms |
| social-schedule | */5 * * * * | Publish queued posts |
| social-publish-scheduled | */5 * * * * | Scheduled post handler |
| social-notify | */15 * * * * | Failure notifications |
| social-metric-sync | 0 */6 * * * | Engagement metrics |
| social-ab-sync | 0 */6 * * * | A/B test metrics |
| social-mentions | 0 */2 * * * | Brand mention monitor |
| social-competitors | 0 7 * * * | Competitor tracking |
| social-recycle | 0 6 * * * | Evergreen post rotation |
| social-weekly-digest | 0 8 * * 1 | Monday performance summary |
| appointment-reminders | 0 7 * * * | SMS/email reminders |
| audit-leads | 0 3 * * * | Daily lead dedup + Meta sync |

### Shared Modules (21 files, ~8,655 LOC)

| Module | Lines | Purpose |
|--------|-------|---------|
| lead-emails.js | 2,509 | Email builders for all programs (DA/EN) |
| social-api.js | 1,764 | Meta/IG/FB Graph API client |
| lead-email-i18n.js | 546 | Bilingual email strings (DA/EN/DE) |
| sequence-trigger.js | 498 | Auto-enrollment + exit conditions |
| instagram-api.js | 418 | Instagram Graph API |
| email-service.js | 391 | Nodemailer/Gmail SMTP |
| sms-service.js | 371 | GatewayAPI SMS wrapper |
| resend-service.js | 348 | Resend email client |
| config.js | 238 | Global config + program definitions |
| firestore.js | 230 | Firebase Admin SDK init |
| utils.js | 220 | CORS, response helpers |
| meta-events.js | 218 | Meta CAPI event builder |
| country-detect.js | 198 | GeoIP + lang → country detection |
| mb-api.js | 138 | MindBody API client |
| auth.js | 94 | Firebase token verification |
| spam-check.js | 98 | Lead spam detection |
| email-tracking.js | 62 | Pixel injection + link wrapping |
| send-limiter.js | 47 | Rate limiting |
| social-ai-helpers.js | 34 | AI caption prompt builders |

---

## 4. Frontend JS Inventory (47+ files, ~45,000 LOC)

### Core Infrastructure (6 files)

| File | Lines | Purpose |
|------|-------|---------|
| header.js | 279 | Dark mega menu, mobile drawer, language detection |
| main.js | 78 | Bilingual toggle (data-yj-da/en), smooth scroll |
| footer.js | 27 | Mobile footer accordion |
| tracking.js | 704 | GTM + Meta CAPI events, scroll depth, conversions |
| cookies.js | 386 | GDPR consent (necessary/statistics/marketing) |
| firebase-auth.js | 874 | Firebase auth, Firestore profiles, content gating |
| roles-permissions.js | 269 | RBAC (member/trainee/student/teacher/marketing/admin) |

### Store & Checkout (4 files)

| File | Lines | Purpose |
|------|-------|---------|
| profile.js | 5,082 | Store catalog (250+ products), age-bracket pricing, MindBody integration, waiver signing |
| checkout-flow.js | 1,008 | 4-step modal: Login → Product → Payment → Success |
| ytt-funnel.js | 369 | CTA-to-checkout funnel tracking → Firestore lead_funnel |
| mindbody.js | 534 | Schedule display, class booking, client sync |

### Page Modules (20+ files)

| File | Lines | Purpose |
|------|-------|---------|
| live.js | 1,463 | Stream viewer (Mux/LiveKit), chat, elapsed timer |
| teacher-studio.js | 1,713 | LiveKit cloud streaming for teachers, device selection |
| course-viewer.js | 1,656 | Course player: chapters, progress, notes, comments |
| schedule-embed.js | 1,200 | Weekly schedule with booking, auth, responsive |
| ytt-schedule.js | 858 | YTT schedule, .ics export, conflict detection |
| vibroyoga.js | 1,170 | Wave/frequency/particle animations |
| vibroyoga-showcase.js | 2,383 | Canvas scroll animations with physics |
| om200.js | 534 | Hero carousel, donut chart, FAQ |
| member.js | 875 | Guest/user toggle, role badge, hash routing tabs |
| appointment-booking.js | 593 | 4-step booking modal |
| workshop-browser.js | 472 | Browse/book individual workshops |
| journal.js | 338 | Search, filter, bilingual toggle, sharing |
| glossary.js | 647 | Multi-language search, dynamic field accessor |
| cb.js | 342 | Course bundle builder, pricing, gallery |
| photo-booking.js | 267 | Request-based photo session booking |
| member-courses.js | 230 | Course listing from Firestore |
| member-materials.js | 178 | Training documents download |
| modal-200ytt.js | 205 | 200h schedule modal + form |
| modal-300ytt.js | 164 | 300h schedule modal |
| course.js | 204 | FAQ accordion, video player |
| historie.js | 95 | Scroll reveal, counter animations |

### Admin Panels (14 files, ~20,000 LOC)

| File | Lines | Purpose |
|------|-------|---------|
| lead-admin.js | 6,154 | Lead CRM: sortable table, status/temperature, notes, SMS/email, bulk actions, CSV |
| social-admin.js | 6,272 | Social: accounts, calendar, posts, analytics, hashtags, competitors, A/B tests |
| course-admin.js | 4,020 | Course/module/chapter CRUD, bulk import, enrollments, analytics |
| campaign-wizard.js | 3,187 | SMS/email campaigns: filter engine, compose, preview, send |
| live-admin.js | 2,374 | Stream management: catalog, MindBody classes, recording stats |
| social-composer.js | 2,202 | Post composer, media browser, AI panel, timezone |
| billing-admin.js | 1,927 | e-conomic: customers, instalments, invoices, VAT |
| email-lists-admin.js | 1,546 | Email lists CRUD, CSV import, engagement tracking |
| appointments-admin.js | 1,358 | Calendar view, filters, CRUD, CSV, .ics |
| social-design-studio.js | 1,211 | Fabric.js canvas editor, brand presets |
| sequences-admin.js | 1,171 | Sequence CRUD, step builder, enrollment management |
| careers-admin.js | 986 | Applications table, filters, status, notes |
| ads-admin.js | 927 | Meta Ads: accounts, campaigns, insights, creative preview |
| nurture-admin.js | 463 | Pipeline overview, sequence health, activity log |
| catalog-admin.js | 548 | Catalog CRUD, filters, toggle, bulk ops |
| doc-admin.js | 634 | Documents: search, category/permission filters |
| knowledge-admin.js | 308 | Agent knowledge: 3 brand tabs, CRUD |

### Tracking (2 files)

| File | Lines | Purpose |
|------|-------|---------|
| schedule-track.js | 103 | Tokenized schedule visits: pageview, scroll, 30s heartbeats |
| site-track.js | 144 | Identified (yb_lid) / anonymous (yb_vid) visitor tracking |

---

## 5. Template Structure

### Eleventy Layout Hierarchy

```
base.njk (master layout)
├── head.njk (SEO meta, JSON-LD, OG, hreflang, GTM, fonts, CSP)
├── header.njk (navigation, mega menu, language switcher)
├── [page content via block]
├── footer.njk (multi-column, mobile accordion)
├── cookies.njk (GDPR consent banner)
└── modals/ (9 globally-loaded modals)
    ├── modal-auth.njk
    ├── modal-checkout-flow.njk (17 KB)
    ├── modal-courses.njk (29 KB)
    ├── modal-schedule.njk
    ├── modal-schedule-300.njk
    ├── modal-appointment.njk
    ├── modal-workshops.njk
    ├── modal-photo-booking.njk
    └── modal-checkout.njk (legacy)
```

### Page Template Pattern (Bilingual)

```
src/_data/i18n/{page}.json     → {"da": {...}, "en": {...}}
src/_includes/pages/{page}.njk → {% set t = i18n.{page}[lang or "da"] %} + {{ t.key }}
src/{page}.njk                 → DA wrapper (lang: da)
src/en/{page}.njk              → EN wrapper (lang: en, permalink: /en/{slug}/)
```

### Template Counts

| Category | Count | Location |
|----------|-------|----------|
| Page templates | 52 | src/_includes/pages/ |
| DA wrappers | 92 | src/*.njk |
| EN wrappers | 40+ | src/en/*.njk |
| Admin partials | 13 | src/_includes/partials/admin-*-panel.njk |
| Modals | 9 | src/_includes/modal-*.njk |
| Components | 4 | src/_includes/components/ |
| i18n data files | 47 | src/_data/i18n/*.json |
| Glossary data | 12 | src/_data/glossary/ |

### Key Pages

**Programs:** om200, p4w, p8w, p18w, p300, vinyasa-plus
**Schedules:** schedule-4w, schedule-8w, schedule-18w, schedule-4w-jul
**Member:** member, course-viewer, live, teacher-studio, appointments
**Admin:** admin-panel (SPA with 13 tab partials)
**Info:** about_copenhagen, meet_the_teachers, mentorship, code_of_conduct, privacy_policy
**Store:** profile (checkout embedded), course bundles

---

## 6. CSS Architecture (11 files, ~48,000 lines)

| File | Lines | Size | Loaded On | Prefix |
|------|-------|------|-----------|--------|
| main.css | 21,295 | 433 KB | Every page | Global + .ycf- (checkout) |
| admin-panel.css | 9,747 | 314 KB | Admin only | .yb-admin__, .yb-lead__, .yb-billing__, .yb-seq__ |
| om200.css | 3,166 | 78 KB | 200h page | .yom200- |
| p18.css | 3,817 | 66 KB | 18w page | .yp18- |
| vibroyoga.css | 2,615 | 57 KB | Vibro page | .yv- |
| p300.css | 1,481 | 42 KB | 300h page | .yp300- |
| cb.css | 1,554 | 35 KB | Bundles page | .ycb- |
| store.css | 1,529 | 30 KB | Store only | .yb-store__ |
| teacher-studio.css | 1,093 | 24 KB | Teacher Studio | .yts- |
| vibroyoga-showcase.css | 809 | 24 KB | Vibro showcase | .yvs- |
| journal.css | 1,157 | 21 KB | Journal only | .yj- |

CSS loading controlled by front matter flags in head.njk: `includeJournal`, `includeStore`, `includeAdmin`, etc.

---

## 7. Data Flow

### Lead Lifecycle

```
Form Submit / Meta Lead Ads
       ↓
  lead.js (validate, dedup via Firestore transaction)
       ↓
  Firestore leads/{hashed_email}
       ↓ (async, non-blocking)
  ├── Admin notification email
  ├── Welcome email (program-specific, bilingual)
  ├── Welcome SMS (bilingual)
  ├── triggerNewLeadSequences() → Broadcast + Onboarding + Program-specific
  ├── Email list auto-sync
  └── Milestone post (every 10 leads)
       ↓
  process-sequences.js (cron */30 min)
       ↓
  Drip emails/SMS (48h throttle, exit conditions checked)
       ↓
  Tracking: email opens/clicks + schedule visits + site visits
       ↓
  Lead scoring → status updates → conversion or exit
```

### Nurture Sequence System (3 Parallel Layers)

| Layer | Audience | Steps | Duration |
|-------|----------|-------|----------|
| Broadcast Nurture | ALL leads | 6 | ~28 days |
| New Lead Onboarding | Undecided | 5 | ~12 days |
| Program-Specific Conversion | Matched leads | 2-4 | Varies |

Plus: Quick Follow-up (2.5h after signup)

**Active Sequence IDs:**

| Sequence | Firestore ID |
|----------|-------------|
| YTT Broadcast Nurture 2026 | Ma2caW2hiQqtkPFesK27 |
| YTT Quick Follow-up | Ue0CYOsPJlnj5SF9PtA0 |
| YTT Onboarding 2026 | Un1xmmriIpUyy2Kui97N |
| April 4W Intensive | ZwvSVLsqRZcIv8C0IG0y |
| 8W Semi-Intensive May-Jun | uDST1Haj1dMyQy0Qifhu |
| 18W Flexible Aug-Dec | ab2dSOrmaQnneUyRojCf |
| July Vinyasa Plus (DK) | Yoq6RCVqTYlF10OPmkSw |
| July Vinyasa Plus (Intl) | {PENDING_ID} |

### Live Streaming & AI Pipeline

```
Teacher → Mux RTMP/WHIP → Recording (asset.ready webhook)
                              ↓
                   ai-process-recording-background.js
                              ↓
                   Deepgram Nova-2 transcription
                              ↓
                   VTT upload to Mux (hardcoded yogabible.dk URL)
                              ↓
                   Claude summary + quiz generation
                              ↓
                   Firestore live-schedule doc updated
                              ↓
                   Students view replay with subtitles
```

**Critical:** VTT URL hardcoded to `https://yogabible.dk` (not env var — www redirect breaks Mux). Word-level fallback essential for 3h+ recordings.

### Authentication & Roles

| Role | Permissions |
|------|-------------|
| member | gated-content |
| trainee | gated-content, live-streaming, recordings |
| student | gated-content |
| teacher | gated-content, live-streaming, recordings |
| marketing | gated-content, admin:content, lead:manage |
| admin | ALL permissions |

Auth: Firebase Auth (frontend) → Firebase ID token → requireAuth middleware (backend) → Firestore users/{uid}.role

### MindBody Integration (20 functions)

Full v6 API wrapper: clients, classes, booking, checkout, contracts, waivers, services, visits, gift cards, staff, site config, purchases, waitlist, sync.

**Checkout flow:** Login → Register → Checkout → Success (4-step modal). MB client created at auth, not at payment.

### Active Products

| Product | MB ID | Price |
|---------|-------|-------|
| 18W Flexible (Mar-Jun 2026) | 100078 | 3,750 DKK |
| 4W Intensive (Apr 2026) | 100121 | 3,750 DKK |
| 4W Vinyasa Plus (Jul 2026) | 100211 | 3,750 DKK |
| 8W Semi-Intensive (May-Jun 2026) | 100209 | 3,750 DKK |
| 18W Flexible (Aug-Dec 2026) | 100210 | 3,750 DKK |
| 300h Advanced | 100212 | 5,750 DKK |
| Inversions / Splits / Backbends | 100145/100150/100140 | 2,300 DKK each |
| Workshop Pass | 100075 | 975 DKK |

---

## 8. Hot Yoga CPH

**Location:** `/hot-yoga-cph/` — separate Netlify deployment

**Architecture:** Static HTML member portal sharing `../netlify/functions` with Yoga Bible. Same Firebase project (yoga-bible-dk-com).

**Key Differences:**
- Brand color: #3f99a5 (HYC cyan) vs #f75c03 (YB orange)
- Primarily EN content
- Member-only features (classes, bookings, payment)
- Public SEO pages: FAQ, pricing (indexed); member area (noindex)

**Shared with YB:** All 111 Netlify Functions, Firebase Auth, MindBody API

**CRITICAL Parity Rule:** Store changes must be replicated to BOTH:
- `src/js/profile.js` + `src/css/main.css` (YB)
- `hot-yoga-cph/public/js/profile.js` + `hot-yoga-cph/public/css/profile.css` (HYC)

**JS Files (7):** profile.js (5123 LOC), checkout-embed.js (2571), firebase-auth.js (885), login-cta.js (1461), mindbody.js (534), schedule-embed.js (1349), roles-permissions.js (255)

---

## 9. External Services Map

| Service | Used For | Key Files | Env Vars |
|---------|----------|-----------|----------|
| **Firebase/Firestore** | Database, auth, real-time | shared/firestore.js, firebase-auth.js | FIREBASE_PROJECT_ID, _CLIENT_EMAIL, _PRIVATE_KEY |
| **MindBody v6** | Booking, payments, memberships | mb-*.js (20 files) | MB_API_KEY, MB_SITE_ID, MB_SOURCE_NAME, MB_SOURCE_PASSWORD |
| **Resend** | Primary email delivery | shared/resend-service.js | RESEND_API_KEY, RESEND_FROM |
| **Gmail SMTP** | Fallback email | shared/email-service.js | GMAIL_USER, GMAIL_APP_PASSWORD |
| **GatewayAPI** | SMS delivery (EU/Denmark) | shared/sms-service.js | GATEWAYAPI_TOKEN |
| **Mux** | HLS video streaming, recording | mux-stream.js, mux-webhook.js | MUX_TOKEN_ID, MUX_TOKEN_SECRET |
| **LiveKit** | Interactive video conferencing | livekit-token.js, live-room-cleanup.js | LIVEKIT_API_KEY, _API_SECRET, _URL |
| **Deepgram** | Speech-to-text (Nova-2) | ai-process-recording-background.js | DEEPGRAM_API_KEY |
| **Anthropic Claude** | AI summaries, quizzes, captions | ai-process-recording-background.js, social-ai.js | ANTHROPIC_API_KEY |
| **Bunny CDN** | Image/file CDN | .eleventy.js (filters), bunny-browser.js | BUNNY_STORAGE_API_KEY, _CDN_HOST |
| **Bunny Stream** | Video hosting (Library 627306) | bunny-stream-webhook.js | BUNNY_STREAM_API_KEY, _LIBRARY_ID, _CDN_HOST |
| **Meta/Facebook** | Lead ads, CAPI, posts | facebook-leads-webhook.js, social-api.js, meta-capi.js | META_ACCESS_TOKEN, META_PIXEL_ID |
| **Instagram** | DMs, posts, stories | instagram-webhook.js, instagram-send.js | INSTAGRAM_ACCESS_TOKEN, _VERIFY_TOKEN |
| **e-conomic** | Danish accounting/ERP | economic-admin.js | ECONOMIC_APP_SECRET, _AGREEMENT_TOKEN |
| **Telegram** | Lead agent notifications | lead-agent/agent.py | TELEGRAM_BOT_TOKEN, _OWNER_CHAT_ID |
| **Netlify** | Hosting, functions, identity | netlify.toml | (platform) |
| **Google APIs** | HYC integrations, Search Console | hot-yoga-cph/, seo-agent/ | GOOGLE_APPLICATION_CREDENTIALS |
| **Canva** | Social media design | social-canva.js | (OAuth via social-accounts) |

---

## 10. Python Automation Agents

### Lead Agent (`lead-agent/`)

**Purpose:** 24/7 AI-powered lead management via Telegram  
**Runtime:** Mac Mini daemon (launchd: com.yogabible.lead-agent)  
**Model:** Claude (configurable via AGENT_MODEL, default: claude-sonnet-4-6)

| File | Size | Purpose |
|------|------|---------|
| agent.py | 59 KB | Telegram bot + Firestore listener + APScheduler |
| knowledge.py | 18 KB | Dynamic system prompt from Firestore agent_knowledge |
| scheduler.py | 5.7 KB | Drip sequence background jobs |
| monitor.py | 4.4 KB | Startup/error/heartbeat notifications |
| tools/ | 8 files | Firestore CRUD, email, SMS, Telegram commands |

### SEO Agent (`seo-agent/`)

**Purpose:** Weekly SEO reports (Mon 8am) + daily quick checks (7am, silent unless issues)  
**Monitors:** 14 key pages, 10 target keywords, 23,750 DKK pricing validation

| File | Size | Purpose |
|------|------|---------|
| agent.py | 5.1 KB | Daemon main + scheduler |
| checks.py | 26 KB | Site audits, structured data, PageSpeed, Search Console |
| api_health.py | 15 KB | Endpoint status monitoring |
| ai_analysis.py | 10 KB | Claude analysis of SEO issues |
| keyword_history.py | 5 KB | Ranking tracking |
| telegram_notify.py | 8 KB | Alert delivery |

### Meta Ads CLI (`ads-agent/` + `scripts/meta-ads-cli.py`)

**Purpose:** Command-line Meta Ads management  
**Accounts:** YB act_1137462911884203, HYC act_518096093802228  
**Commands:** 40+ (campaigns, insights, creative, budget, pause/resume, create, duplicate)

---

## 11. Build & Deployment Pipeline

### Build Command (netlify.toml)

```bash
rm -rf _site/css _site/js && \
node scripts/write-firebase-key.js && \
npx @11ty/eleventy && \
node scripts/parallel-post-build.js
```

### Post-Build Pipeline (7 steps)

| Step | Script | Purpose |
|------|--------|---------|
| 1-4 (parallel) | parallel-post-build.js | minify-js, purge-css, optimize-images, critical-css |
| 5 | hash-assets.js | Content-hash filenames for cache busting |
| 6 | seo-validator.js | Final SEO audit |
| 7 | (deploy) | Publish _site/ to Netlify CDN |

### Eleventy Config (.eleventy.js)

**Filters/Shortcodes:**
- `cloudimg()` — Bunny CDN URL with transforms
- `cldimg()` — Responsive <picture> tag (WebP + JPEG)
- `cldvid()` — Video with poster
- Bunny manifest fetched at build time (resolves extensionless paths)
- Legacy Cloudinary transform → Bunny optimizer param conversion

### Redirects (30+ rules in netlify.toml)

- www → non-www
- en.yogabible.dk → /en/
- Legacy Squarespace slugs
- Admin SPA routing (/* → /admin/)
- Asset 404 handling

### Security Headers

CSP, X-Frame-Options (SAMEORIGIN), HSTS, Permissions-Policy, X-Content-Type-Options (nosniff)

### Cache Rules

- Hash-based assets: 1 year, immutable
- Unhashed assets: 1 hour
- Favicons: immutable

---

## 12. Firestore Collections

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| leads | Lead CRM | email, status, temperature, form_score, schedule_token, engagement data |
| applications | YTT applications | status workflow, program, linked lead |
| sequences | Nurture definitions | steps[], exit_conditions, enrollment_closes |
| lead_drip_sequences | Enrollment state | current_step, last_sent, completed |
| email_log | Send history | to, subject, source_tag, timestamp |
| live-schedule | Broadcast sessions | muxLiveStreamId, aiStatus, transcript, VTT |
| courses | Course content | modules, chapters, lessons, enrollment |
| social_media | Social posts | platform, status, schedule_time, metrics |
| social_accounts | OAuth tokens | encrypted tokens, refresh timestamps |
| agent_knowledge | Dynamic AI knowledge | brand-specific FAQs, context |
| users | Auth profiles | uid, role, MindBody client ID |
| consents | Waiver signatures | GDPR, liability, timestamps |
| appointments | Bookings | datetime, type, status, linked client |
| lead_funnel | Purchase funnel | stage, product, timestamps |
| email_engagement | Open/click tracking | pixel opens, link clicks |
| site_engagement | Page visit tracking | pages, interests, re-engagement |
| schedule_engagement | Schedule visit tracking | token verification, IP, timestamps |

---

## 13. Scripts Inventory

| Script | Type | Purpose |
|--------|------|---------|
| parallel-post-build.js | Build | Run 4 post-build tasks concurrently |
| minify-js.js | Build | Terser JS compression |
| purge-css.js | Build | PurgeCSS unused class removal |
| optimize-images.js | Build | Image compression + WebP |
| critical-css.js | Build | Above-fold CSS extraction |
| hash-assets.js | Build | Content-hash cache busting |
| seo-validator.js | Build | SEO audit (pricing, meta, structure) |
| write-firebase-key.js | Build | Firebase key from env var |
| git-auto-sync.sh | Automation | Bidirectional GitHub sync (launchd, 5 min) |
| com.yogabible.git-sync.plist | Config | macOS launchd for git sync |
| meta-ads-cli.py | CLI Tool | Meta Ads management (40+ commands) |
| enroll-existing-leads.js | Migration | Migrate leads into nurture sequences |
| seed-nurture-sequences.js | Migration | Create/update Firestore sequences |
| seed-careers.js | Migration | Populate careers content |
| audit-and-fix-sequences.js | Maintenance | Validate + fix sequence issues |
| migrate-to-firestore.js | Migration (legacy) | Sheets → Firestore (one-time) |

---

## 14. Current State Assessment

### Strengths

- **Atomic lead dedup** via Firestore transactions prevents race conditions
- **Comprehensive bilingual system** — DA/EN at every layer (templates, emails, SMS, sequences)
- **Multi-provider email** with automatic fallback (Resend → Gmail)
- **3-layer tracking** (email engagement, schedule visits, site behavior) with re-engagement detection
- **Multi-layer nurture** (Broadcast + Onboarding + Program-specific) running in parallel
- **End-to-end AI pipeline** (Deepgram → VTT → Claude summary/quiz) with word-level fallback
- **Full MindBody integration** (20 endpoints covering entire studio operation)
- **Dynamic agent knowledge** refreshed from Firestore in real-time
- **Sophisticated social media system** (28 functions: publishing, analytics, A/B testing, AI captions)
- **Clean CSS prefix architecture** preventing style conflicts

### Known Critical Constraints

1. **VTT URL hardcoded** to `https://yogabible.dk` — env var (www.yogabible.dk) causes 301 → Mux silent failure
2. **Deepgram word-level fallback** (`buildUtterancesFromWords()`) — essential for 3h+ recordings, do NOT remove
3. **Sequential retranscribe** — Deepgram returns 504 on parallel long recordings
4. **July International sequence ID pending** — `{PENDING_ID}` not yet assigned
5. **Dual-site parity** — profile.js + CSS must stay synced between YB and HYC
6. **Test product 100203** in ytt-funnel.js line 33 — must NOT be used in production
7. **Prep Phase terminology** — "Preparation Phase"/"Forberedelsesfasen", NEVER "deposit"/"depositum"
8. **Course language** — taught in English but NEVER mentioned in marketing
9. **Refund policy** — Prep Phase non-refundable but NEVER mentioned in marketing

### Potential Technical Debt

- **profile.js at 5,082 lines** — largest single JS file, handles store catalog + member profile + waiver system
- **lead-admin.js at 6,154 lines** — massive admin CRM interface
- **social-admin.js at 6,272 lines** — complex social media management
- **main.css at 21,295 lines** — could benefit from further splitting
- **No JS bundler** — all 47 files are standalone IIFEs loaded via script tags
- **lead-emails.js at 2,509 lines** — growing email template library
- **social-api.js at 1,764 lines** — complex Meta/IG API client
- **Multiple duplicate files** between YB and HYC (profile.js, firebase-auth.js, etc.)

### Build Scripts Assessment

| Script | Type | Reusable? |
|--------|------|-----------|
| parallel-post-build.js | Build | Yes (runs on every deploy) |
| minify-js/purge-css/optimize-images/critical-css/hash-assets | Build | Yes |
| seo-validator.js | Build | Yes |
| write-firebase-key.js | Build | Yes |
| git-auto-sync.sh | Automation | Yes (launchd daemon) |
| meta-ads-cli.py | CLI | Yes (daily use) |
| enroll-existing-leads.js | Migration | One-time (but re-runnable) |
| seed-nurture-sequences.js | Migration | One-time per sequence update |
| seed-careers.js | Migration | One-time |
| migrate-to-firestore.js | Migration | One-time (legacy, done) |
| audit-and-fix-sequences.js | Maintenance | Reusable (troubleshooting) |

---

## 15. Summary Statistics

| Metric | Count |
|--------|-------|
| Total files (non-build) | ~1,138 |
| Netlify Functions | 111 |
| Shared function modules | 21 |
| Frontend JS files | 47+ |
| Frontend JS total LOC | ~45,000 |
| CSS files | 11 |
| CSS total lines | ~48,000 |
| Nunjucks templates | ~185 |
| i18n data files | 47 |
| Glossary categories | 10 |
| Admin panel tabs | 13 |
| Scheduled cron functions | 18 |
| MindBody endpoints | 20 |
| Social media functions | 28 |
| Active product IDs | 16 |
| Nurture sequences | 8 (1 pending) |
| Python agents | 3 |
| Build/utility scripts | 19 |
| External service integrations | 18 |
| Environment variables | 58 |
| Firestore collections | 17+ |
| npm dependencies | 9 |
| Languages supported | 2 (DA primary + EN) |

---

*Audit completed April 21, 2026. Read-only — no files modified.*
