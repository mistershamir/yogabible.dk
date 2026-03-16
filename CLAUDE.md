# Yoga Bible DK — Project Instructions

## Blog Writing Agent

When asked to write a blog/journal post, follow this workflow:

### 1. Topic Discussion
- Discuss the topic with the user first
- Agree on angle, audience, key points, and tone
- Confirm bilingual approach (Danish primary, English translation)

### 2. Content Creation
Add a new entry to `src/_data/journals.json` inside the `"entries"` array. Each entry must have ALL these fields:

```json
{
  "slug": "url-friendly-slug-in-danish",
  "date": "YYYY-MM-DD",
  "author": "Yoga Bible",
  "category": "yoga-styles|pranayama|philosophy|wellness|teacher-training",
  "tags": ["tag1", "tag2", "tag3"],
  "featured": false,
  "gated": false,
  "image": "/assets/images/journal/slug-name.jpg",
  "readTime_da": "X min",
  "readTime_en": "X min",
  "title_da": "Danish Title",
  "title_en": "English Title",
  "excerpt_da": "Danish excerpt (1-2 sentences, SEO-friendly)",
  "excerpt_en": "English excerpt (1-2 sentences, SEO-friendly)",
  "content_da": "<p>Danish HTML content...</p>",
  "content_en": "<p>English HTML content...</p>"
}
```

### 3. Content HTML Design Patterns
Each blog should use rich, varied HTML. Available elements:

**Headings** — Use `<h2>` for main sections, `<h3>` for subsections (styled with top border dividers and orange accents)

**Paragraphs** — `<p>` with `<strong>` for emphasis (renders dark), `<em>` for italic (renders orange)

**Lists** — `<ul>` or `<ol>` with `<li>` (orange bullet markers automatically applied)

**Blockquotes** — `<blockquote>` for quotes, teacher insights, or key takeaways (styled with orange left border, cream background, rounded corners)

**Links** — `<a href="...">` (orange with underline, matches brand)

**Line breaks in flow** — `<br>` within paragraphs for structured info (e.g., chakra descriptions)

**Design tips for engaging posts:**
- Start with a compelling opening paragraph (first letter gets automatic drop cap styling)
- Use h2 sections every 2-3 paragraphs to create visual rhythm
- Mix list types (bullets for features, numbered for steps)
- Include at least one blockquote per post
- End with a CTA paragraph linking to relevant Yoga Bible pages
- Keep paragraphs short (3-4 sentences max)
- Use `<strong>` liberally for scannable content

### 4. Bilingual Quality
- Danish is the PRIMARY language — write it naturally, not as a translation
- English should read naturally too, not be a literal translation
- Both versions should have the same structure (same h2s, same lists)
- Danish SEO: use Danish yoga terminology naturally
- English SEO: use standard English yoga terms

### 5. SEO Best Practices
- Slug: Danish, lowercase, hyphens (e.g., `fordelene-ved-yin-yoga`)
- Title: Include primary keyword, under 60 chars
- Excerpt: Include keyword, compelling, 150-160 chars
- Content: Use keywords naturally in h2s and first paragraphs
- Tags: 3-5 relevant tags from existing ones or new descriptive ones
- Categories: MUST be one of: `yoga-styles`, `pranayama`, `philosophy`, `wellness`, `teacher-training`

### 6. After Writing
- Build with `npx @11ty/eleventy` to verify
- Commit to current branch
- Push to remote

### 7. Image Placeholder
- Default image: `/assets/images/og/og-1200x630.png`
- For custom images: place in `src/assets/images/journal/` named as `{slug}.jpg`
- Recommended size: 1200x630px (OG/hero compatible)

## Bilingual i18n System (MANDATORY)

**IMPORTANT:** This site is fully bilingual (Danish + English). ALL pages must exist in both languages. Danish is the primary language. English pages live under `/en/`.

### How It Works

Every page follows this pattern — **no exceptions**:

1. **Translation data:** `src/_data/i18n/{page}.json` — contains `{"da": {...}, "en": {...}}` with all translatable strings
2. **Shared template:** `src/_includes/pages/{page}.njk` — uses `{% set t = i18n.{page}[lang or "da"] %}` and `{{ t.key }}` for all text
3. **DA wrapper:** `src/{page}.njk` — thin file with front matter (lang: da) + `{% include "pages/{page}.njk" %}`
4. **EN wrapper:** `src/en/{page}.njk` — thin file with front matter (lang: en, permalink: /en/{slug}/) + `{% include "pages/{page}.njk" %}`

### Auto-loaded data
- `src/_data/i18n.js` auto-loads all `.json` files from `src/_data/i18n/`
- `src/en/en.11tydata.json` sets `lang: "en"` for all EN pages automatically

### Rules for editing existing pages

- **Always update the JSON** (`src/_data/i18n/{page}.json`) — both `da` and `en` keys
- **Never hardcode text** in the shared template — use `{{ t.key }}` or `{{ t.key | safe }}` (for HTML)
- **Internal links** must be language-aware: `{% if lang == 'en' %}/en/path{% else %}/path{% endif %}`
- **Shared footer translations** are in `src/_data/i18n/common.json`

### Rules for creating new pages

1. Create `src/_data/i18n/{page}.json` with both `da` and `en` objects
2. Create `src/_includes/pages/{page}.njk` using translation keys
3. Create `src/{page}.njk` as thin DA wrapper (include front matter with `lang: da`)
4. Create `src/en/{page}.njk` as thin EN wrapper (include `lang: en` + `permalink: /en/{slug}/`)
5. Add navigation links using `{% set lp = "/en" if lang == "en" else "" %}` prefix pattern
6. Verify build: `npx @11ty/eleventy`

### Language-aware patterns used in templates

```nunjucks
{# Link prefix for internal links in header/footer #}
{% set lp = "/en" if lang == "en" else "" %}
<a href="{{ lp }}/kontakt">...</a>

{# Conditional links in page content #}
<a href="{% if lang == 'en' %}/en/kontakt{% else %}/kontakt{% endif %}">...</a>

{# Translation reference #}
{% set t = i18n.{page}[lang or "da"] %}
{{ t.title }}           {# plain text #}
{{ t.content | safe }}  {# HTML content #}
```

---

## Bilingual Email & SMS System (MANDATORY)

**IMPORTANT:** ALL automated emails and SMS messages MUST exist in both Danish and English. When creating or modifying any email template, drip sequence step, or SMS message, you MUST build both the DA and EN versions. English leads must receive the same level of detail as Danish leads — never a "generic" fallback.

### How It Works

- **Translation data:** `netlify/functions/shared/lead-email-i18n.js` — central i18n file with `SHARED`, `PROGRAMS`, `SCHEDULE_PATHS`, `PROGRAM_PAGES` objects, each containing `da` and `en` keys
- **Email builders:** `netlify/functions/shared/lead-emails.js` — bilingual email functions that accept a `lang` parameter (`'da'` or `'en'`)
- **Language detection:** `lead.lang` field determines email language. Set from website path detection (`/en/` prefix → `'en'`) or Meta form `lang` field
- **Schedule URLs:** English leads get `/en/schedule/*` paths; Danish leads get `/tidsplan/*` paths. Both use tokenized `?tid=&tok=` params

### Rules for Email/SMS Changes

1. **Always update both languages** in `lead-email-i18n.js` — every key must have both `da` and `en` values
2. **Never send a generic email** to English leads when a program-specific version exists in Danish
3. **Schedule CTAs** must link to the correct language path (use `scheduleUrl(programKey, lang, tokenData)`)
4. **New program types** require: add to `PROGRAMS` object in i18n file + add email builder in `lead-emails.js` + add routing in `sendWelcomeEmail`
5. **SMS messages** must also be bilingual — check `shared/sms-service.js`
6. **Drip sequences** (lead-agent) must send language-appropriate content based on `lead.lang`

### Program Email Routing

| Lead Type | DA Function | EN Function |
|-----------|------------|-------------|
| 4-week, 8-week, 18-week, 4-week-jul, 18-week-aug | `sendEmail{X}wYTT()` | `sendProgramEmail(lead, key, 'en', token)` |
| 300h, specialty (50h/30h) | `sendEmail300hYTT()` / `sendEmailSpecialtyYTT()` | `sendProgramEmail(lead, key, 'en', token)` |
| Multi-format | `sendEmailMultiFormat()` | `sendMultiFormatEmail(lead, 'en', token)` |
| Undecided | `sendEmailUndecided()` | `sendUndecidedEmail(lead, 'en', token)` |
| Courses | `sendEmailCourses()` | `sendCoursesEmail(lead, 'en')` |
| Mentorship | `sendEmailMentorship()` | `sendMentorshipEmail(lead, 'en')` |
| Generic/Contact | `sendEmailGeneric()` | `sendEmailGenericBilingual(lead, 'en')` |

---

## Schedule Pages & Conflict Finder

All YTT schedule pages include a **Conflict Finder** — an interactive tool that lets prospective students check which training days clash with their busy schedule.

### Schedule Pages

| Page | Template | i18n JSON | Prefix |
|------|----------|-----------|--------|
| 4-Week Intensive (Apr) | `schedule-4w.njk` | `schedule_4w.json` | `s4w-` |
| 4-Week Vinyasa Plus (Jul) | `schedule-4w-jul.njk` | `schedule_4w_jul.json` | `s4wj-` |
| 8-Week Semi-Intensive | `schedule-8w.njk` | `schedule_8w.json` | `s8w-` |
| 18-Week Flexible (Apr) | `schedule-18w.njk` | `schedule_18w.json` | `s18w-` |
| 18-Week Flexible (Aug) | `schedule-18w-aug.njk` | `schedule_18w_aug.json` | `s18w-` |

### Conflict Finder Architecture

**Location:** Each schedule template (`src/_includes/pages/schedule-*.njk`) contains the conflict finder as a `<details>` accordion placed between the hours breakdown and the schedule body.

**How it works:**
1. User marks which days of the week they're busy (checkboxes with time ranges)
2. User can add specific dates they can't attend
3. Clicking "Check conflicts" compares their busy times against the training schedule
4. **Single-track programs (4w, 4w-jul, 8w):** Shows number of conflicting training days + lists them
5. **Dual-track programs (18w, 18w-aug):** Compares weekday vs weekend track, recommends the best fit

**i18n keys (required for conflict finder):**
- `conflictTitle`, `conflictDesc`, `conflictBtn`
- `conflictSpecificLabel`, `conflictSpecificHint`, `conflictAddDate`
- `conflictDateFrom`, `conflictDateTo`
- Single-track: `conflictResultTitle`, `conflictNone`, `conflictSome`
- Dual-track: `conflictSpecificHits`, `bestMatchLabel`, `bothFitLabel`, `recommendLabel`, `conflictsOfLabel`, `conflictBaseRecommend`, `conflictNoConflict`
- All: `conflictNote` (HTML with contact links)

**JS pattern:** Each prefix (`s4w-`, `s8w-`, `s18w-`, etc.) namespaces all DOM IDs, CSS classes, and JS functions to avoid conflicts when multiple schedules might coexist. The training dates are hardcoded as a JS array in the `<script>` block at the bottom of each template.

### Adding a Conflict Finder to a New Schedule

1. Add conflict i18n keys to the schedule's JSON file (both `da` and `en`)
2. Add the `<details>` HTML block between hours breakdown and schedule body
3. Add the JS block with: toggle function, specific date adder, schedule dates array, check function, chevron toggle
4. Use a unique prefix for all IDs/classes (e.g., `s4w-`, `s8w-`)
5. Build and verify: `npx @11ty/eleventy`

---

## Architecture Reference

- **Framework:** Eleventy v3.1.2, Nunjucks templates
- **Data:** `src/_data/journals.json` (wrapped: `{"entries": [...]}`)
- **Listing:** `src/yoga-journal.njk` → `/yoga-journal/`
- **Posts:** `src/yoga-journal-post.njk` (Eleventy pagination, size:1)
- **JS:** `src/js/journal.js` — language switching, search, progress bar, share
- **CSS:** Split across 4 files for performance (see **CSS Architecture** below)
- **CMS:** Decap CMS at `/admin/` with Netlify Identity
- **i18n:** Build-time via JSON files in `src/_data/i18n/`, path-based (`/en/` prefix). Journal uses `data-yj-da`/`data-yj-en` attributes toggled by path detection.
- **Deploy:** Netlify from `main` branch
- **Design System:** `src/samples.njk` → `/samples/` — the single source of truth for all UI components
- **Profile/Store:** `src/js/profile.js` — user profile, store catalog, checkout, waiver, schedule, membership
- **Hot Yoga CPH:** `hot-yoga-cph/public/js/profile.js` + `hot-yoga-cph/public/css/profile.css` — mirrored store/profile for HYC site
- **Apps Script:** `apps-script/` — legacy Google Sheets-based lead/application system (13 files). Being replaced by Netlify functions + Firestore.

### CSS Architecture (MANDATORY)

**IMPORTANT:** CSS is split into 4 files for performance. Each file serves specific pages. When adding or modifying styles, put them in the correct file — NEVER dump everything into `main.css`.

| File | Loaded On | Contains | Prefix(es) |
|------|-----------|----------|------------|
| `src/css/main.css` | **Every page** | Global styles: header, footer, hero, typography, buttons, forms, cards, design system, glossary, schedule, landing pages, responsive base | Various global |
| `src/css/journal.css` | Journal pages only | Blog listing, post layout, search, filters, tags, author card, related posts | `.yj-` |
| `src/css/store.css` | Profile/store pages only | Store catalog, checkout modal, categories, badges, product cards, deposit items | `.yb-store__` |
| `src/css/admin-panel.css` | Admin panel only | Admin tabs, lead management, campaigns, billing, documents, knowledge base, sequences | `.yb-admin__`, `.yb-kb__`, `.yb-lead__`, `.yb-billing__`, `.yb-doc-browser__`, `.yb-seq__` |

**How conditional loading works:**

Pages opt into extra CSS via front matter flags:
- `includeJournal: true` → loads `journal.css`
- `includeStore: true` → loads `store.css`
- `includeAdmin: true` → loads `admin-panel.css`

These flags are checked in `src/_includes/head.njk` with `{% if includeJournal %}` etc.

**Rules for adding new CSS:**

1. **Global components** (header, footer, hero, buttons, design system, new landing pages) → `main.css`
2. **Journal/blog styles** (`.yj-` prefix) → `journal.css`
3. **Store/checkout/profile styles** (`.yb-store__` prefix) → `store.css`
4. **Admin panel styles** (`.yb-admin__`, `.yb-lead__`, `.yb-billing__`, `.yb-kb__`, `.yb-doc-browser__`, `.yb-seq__`) → `admin-panel.css`
5. **New page-specific styles** that are large (500+ lines) → consider creating a new split file with a new front matter flag
6. **When creating a new page** that needs store/journal/admin styles, add the appropriate front matter flag to both the DA and EN wrapper `.njk` files
7. **Checkout flow modal** (`.ycf-` prefix) lives in `main.css` because it can appear on any page

### Netlify Functions Reference

All serverless functions live in `netlify/functions/`. Shared code in `netlify/functions/shared/` (auth, firestore, utils, config).

**Auth pattern:** Client sends Firebase ID token via `Authorization: Bearer <token>`. Server uses `requireAuth(event, ['admin'])` from `shared/auth.js`. Roles stored in Firestore `users/{uid}.role`.

| Function | Purpose |
|----------|---------|
| **Lead & CRM** | |
| `lead` | Lead capture endpoint (public — forms, webhooks) |
| `leads` | Leads CRUD API (admin) |
| `facebook-leads-webhook` | Facebook Lead Ads real-time webhook |
| `facebook-leads-backfill` | Backfill historical Facebook leads |
| `campaign-log` | Campaign log endpoint |
| `sms-webhook` | Inbound SMS webhook (GatewayAPI) |
| `sms-conversations` | SMS conversations API (admin) |
| `send-email` | Send email endpoint |
| `send-sms` | Send SMS endpoint |
| `send-acceptance-email` | Send acceptance email to applicants |
| `unsubscribe` | Email unsubscribe endpoint |
| **Applications** | |
| `apply` | Application builder (public form submission) |
| `applications` | Applications CRUD API (admin) |
| `activate-applicant` | Activate applicant account after acceptance |
| `status` | Application status lookup (public) |
| `migrate-applications` | One-time migration from legacy system |
| **Appointments** | |
| `appointments` | Appointments CRUD (admin) |
| `appointment-book` | Appointment booking (public) |
| `appointment-reminders` | Scheduled appointment reminders |
| **MindBody Integration** (`mb-*`) | |
| `mb-client` | Client lookup/create/update + stored card detection |
| `mb-classes` | Fetch class schedules |
| `mb-class-descriptions` | Fetch class descriptions |
| `mb-services` | List available services |
| `mb-book` | Book/cancel class visits |
| `mb-checkout` | Payment checkout (card + stored card) |
| `mb-contracts` | List contracts |
| `mb-contract-manage` | Manage contract actions |
| `mb-purchases` | Purchase history |
| `mb-return-sale` | Process sale returns |
| `mb-client-services` | Client active services/passes |
| `mb-giftcards` | Gift card endpoints |
| `mb-visits` | Visit history |
| `mb-waitlist` | Waitlist management |
| `mb-waiver` | Liability waiver check/sign |
| `mb-staff` | Staff list |
| `mb-site` | Site info |
| `mb-sync` | Sync MindBody data |
| **Admin Panels** | |
| `catalog-admin` | Course catalog CRUD (admin) |
| `economic-admin` | e-conomic invoicing API (admin) |
| `live-admin` | Live stream schedule CRUD + MindBody import (admin) |
| `knowledge-admin` | Agent knowledge base CRUD — 3 brands (admin) |
| `email-templates` | Email template preview/management (admin) |
| `cloudinary-browser` | Cloudinary folder/asset browser (admin) |
| **Other** | |
| `catalog` | Public course catalog endpoint |
| `catalog-seed` | Seed catalog with initial data |
| `careers` | Careers form submission |
| `careers-seed` | Seed careers with initial data |
| `member-documents` | Member training documents |
| `seed-trainee-materials` | Seed trainee course materials |
| `schedule-token` | Schedule token validator |
| `auth-token` | Firebase auth token helper |
| `health` | Health check endpoint |
| `meta-capi` | Meta Conversions API (Facebook pixel server-side) |
| `mux-webhook` | Mux video webhook (live streaming) |
| `mux-stream` | Browser-based Mux live stream creation for Teacher Studio |
| `livekit-token` | LiveKit room creation + JWT token generation (interactive/panel streams) |
| `ai-process-recording-background` | Recording → captions → AI summary + quiz pipeline (15-min timeout) |
| `ai-backfill` | Utility for reprocessing past recordings (debug, reconcile, retranscribe) |
| `instagram-webhook` | Instagram webhook handler |
| `instagram-send` | Send Instagram messages |
| `instagram-token-refresh` | Scheduled: refresh Instagram API token |

### Client-Side JS Reference

All JS files in `src/js/`. No bundler — each is a standalone IIFE loaded via `<script>` tags.

| File | Purpose |
|------|---------|
| **Core** | |
| `header.js` | Navigation, mobile menu, scroll behavior |
| `footer.js` | Footer interactions |
| `main.js` | Global utilities, animations, scroll triggers |
| `cookies.js` | Cookie consent banner |
| `tracking.js` | Analytics tracking (Meta pixel, GA) |
| `firebase-auth.js` | Firebase auth (login/register/reset modals) |
| `roles-permissions.js` | Role-based access control |
| **Profile & Store** | |
| `profile.js` | User profile, store catalog, checkout, waiver, schedule, membership (main store logic) |
| `checkout-flow.js` | Multi-step checkout modal (auth → register → pay → success) |
| `ytt-funnel.js` | YTT purchase funnel entry point — calls `openCheckoutFlow()` |
| `mindbody.js` | MindBody API client-side helpers |
| **Page-Specific** | |
| `journal.js` | Blog listing — language switch, search, progress bar, share |
| `glossary.js` | Yoga glossary page — search, filter, letter nav |
| `schedule-embed.js` | MindBody schedule embed |
| `appointment-booking.js` | Appointment booking flow |
| `course.js` | Course page interactions |
| `course-viewer.js` | Course content viewer (enrolled students) |
| `member.js` | Member area |
| `member-courses.js` | Member course list |
| `member-materials.js` | Member training materials viewer |
| `live.js` | Live stream page (broadcast + interactive + panel modes, LiveKit/Mux) |
| `link.js` | Link-in-bio page |
| `cb.js` | Course bundles page |
| `ytt-schedule.js` | YTT schedule page |
| `vibroyoga.js` | Vibro Yoga page |
| `vibroyoga-showcase.js` | Vibro Yoga showcase page |
| `photo-booking.js` | Photography booking |
| `om200.js` | 200hr YTT overview page |
| `p300.js` | 300hr YTT overview page |
| `modal-200ytt.js` | 200hr YTT info modal |
| `modal-300ytt.js` | 300hr YTT info modal |
| `campaign-wizard.js` | Email/SMS campaign wizard (admin) |
| **Admin** | |
| `course-admin.js` | Course builder admin |
| `catalog-admin.js` | Catalog CRUD admin |
| `lead-admin.js` | Lead management + drip campaigns admin |
| `live-admin.js` | Live schedule admin |
| `billing-admin.js` | e-conomic invoicing admin |
| `doc-admin.js` | Document management admin |
| `careers-admin.js` | Careers/jobs admin |
| `appointments-admin.js` | Appointment management admin |
| `knowledge-admin.js` | Agent knowledge base admin (3 brand tabs) |

### Admin Panel

Located at `/admin/` (`src/admin-panel.njk` → `src/_includes/pages/admin.njk`). Firebase auth-gated with role check. Translations in `src/_data/i18n/course-admin.json`.

**Tabs:** Courses, Users, Analytics, Leads, Applications, Careers, Appointments, Catalog, Documents, Live, Billing, Knowledge

Each tab has a partial in `src/_includes/partials/admin-{name}-panel.njk` and a corresponding JS file in `src/js/{name}-admin.js`.

### Environment Variables

**Netlify Functions** (set in Netlify dashboard):

| Variable | Purpose |
|----------|---------|
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email |
| `FIREBASE_PRIVATE_KEY` | Firebase service account private key |
| `MB_API_KEY` | MindBody API key |
| `MB_SITE_ID` | MindBody site ID |
| `MB_SOURCE_NAME` | MindBody source credentials |
| `MB_SOURCE_PASSWORD` | MindBody source credentials |
| `GMAIL_USER` | Gmail SMTP user (info@yogabible.dk) |
| `GMAIL_APP_PASSWORD` | Gmail app-specific password |
| `GATEWAYAPI_TOKEN` | GatewayAPI (SMS) token |
| `ECONOMIC_APP_SECRET` | e-conomic API app secret |
| `ECONOMIC_AGREEMENT_TOKEN` | e-conomic agreement token |
| `UNSUBSCRIBE_SECRET` | HMAC secret for unsubscribe tokens |
| `MUX_TOKEN_ID` | Mux video token |
| `MUX_TOKEN_SECRET` | Mux video secret |
| `META_ACCESS_TOKEN` | Meta Conversions API token |
| `META_PIXEL_ID` | Meta pixel ID |
| `INSTAGRAM_ACCESS_TOKEN` | Instagram API token |
| `INSTAGRAM_VERIFY_TOKEN` | Instagram webhook verify token |
| `CLOUDINARY_API_KEY` | Cloudinary API key (`617726211878669`) |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `AI_INTERNAL_SECRET` | AI backfill/Mux processing secret (`2f8a6b592a15b8ac92021d791fdbd0fb48ef61c96899407c2d2e50030933c576`) |
| `LIVEKIT_API_KEY` | LiveKit API key (interactive/panel streaming) |
| `LIVEKIT_API_SECRET` | LiveKit API secret |
| `LIVEKIT_URL` | LiveKit server URL (wss://...) |
| `ANTHROPIC_API_KEY` | Claude API key (for AI recording processing) |

**Lead Agent** (`lead-agent/.env`):

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `GMAIL_USER` | Gmail SMTP (same as Netlify) |
| `GMAIL_APP_PASSWORD` | Gmail app password (same as Netlify) |
| `GATEWAYAPI_TOKEN` | SMS token (same as Netlify) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to Firebase service account JSON |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_OWNER_CHAT_ID` | Shamir's Telegram chat ID |
| `AGENT_MODEL` | Claude model ID (default: `claude-sonnet-4-6`) |
| `DRIP_CHECK_INTERVAL_MINUTES` | Drip scheduler interval (default: 60) |
| `SITE_URL` | Site URL (default: `https://yogabible.dk`) |

---

## Meta Ads CLI (for Claude Code sessions)

**IMPORTANT:** When asked about Meta/Facebook ad campaigns, performance, or ad management — use this CLI tool. It gives you full read/write access to the Meta Marketing API.

### Setup

The CLI reads `META_ACCESS_TOKEN` from `ads-agent/.env` (already configured). No extra setup needed.

### Usage

```bash
python3 scripts/meta-ads-cli.py <command> [args...]
```

### Available Commands

| Command | Description |
|---------|-------------|
| **Read Operations** | |
| `accounts` | List ad accounts (Yoga Bible + Hot Yoga CPH) |
| `campaigns [brand]` | List campaigns (`yb` or `hyc`, default: yb) |
| `campaigns yb --status=ACTIVE` | Filter by status (ACTIVE, PAUSED, ARCHIVED) |
| `insights <campaign_id> [days]` | Campaign performance (spend, leads, CTR, CPL) |
| `account-insights [brand] [days]` | Account-level summary |
| `adsets <campaign_id>` | List ad sets in a campaign (with targeting summary) |
| `adset-insights <adset_id> [days]` | Ad set performance |
| `ads <adset_id>` | List ads in an ad set |
| `ad-insights <ad_id> [days]` | Individual ad performance |
| `creative <ad_id>` | Get ad creative details (primary text, headline, CTA, link, image) |
| `audiences [brand]` | List custom audiences |
| `leadforms [brand]` | List instant forms (lead gen forms) |
| `leadform <form_id>` | Get form details + questions |
| `page-posts [brand]` | List recent page posts |
| **Modify Operations** | |
| `pause <id>` | Pause a campaign, ad set, or ad |
| `resume <id>` | Resume (activate) |
| `archive <id>` | Archive |
| `delete <id>` | Delete |
| `budget <id> <daily_dkk>` | Update daily budget (in DKK) |
| `lifetime-budget <id> <amount_dkk>` | Update lifetime budget |
| `duplicate <id>` | Duplicate entity (created as PAUSED) |
| `update-ad-text <ad_id> <field> <value>` | Update ad text (primary_text, headline, description, link, cta) |
| **Create Operations** | |
| `create-campaign <brand> <name> <objective> <daily_budget>` | Create campaign (PAUSED) |
| `create-adset <campaign_id> <name> <budget> <targeting.json>` | Create ad set from targeting JSON |
| `create-ad <adset_id> <name> <creative.json>` | Create ad from creative JSON |
| `create-audience <brand> <name> <description>` | Create custom audience |
| `create-leadform <brand> <form.json>` | Create instant form from JSON spec |

### Workflow Examples

**Check why a campaign isn't performing:**
```bash
python3 scripts/meta-ads-cli.py campaigns yb --status=ACTIVE
python3 scripts/meta-ads-cli.py insights <campaign_id> 7
python3 scripts/meta-ads-cli.py adsets <campaign_id>
python3 scripts/meta-ads-cli.py creative <ad_id>
```

**Update ad copy:**
```bash
python3 scripts/meta-ads-cli.py update-ad-text <ad_id> primary_text "New primary text here..."
python3 scripts/meta-ads-cli.py update-ad-text <ad_id> headline "New Headline"
```

**Create a new campaign:**
```bash
python3 scripts/meta-ads-cli.py create-campaign yb "YTT April 2026 - Leads" OUTCOME_LEADS 150
# Then create ad set with targeting JSON file, then create ad with creative JSON file
```

### Ad Accounts

| Brand | Account ID | Currency |
|-------|-----------|----------|
| Yoga Bible (`yb`) | `act_1137462911884203` | DKK |
| Hot Yoga CPH (`hyc`) | `act_518096093802228` | DKK |

### Notes

- All budgets are in **DKK** (the CLI handles the ×100 conversion for the API)
- Created entities default to **PAUSED** — activate manually after review
- `days` parameter: 1, 7, 14, 28, 30, or 90
- The `creative` command shows primary text, headline, description, CTA, and image URL
- For create operations that need JSON files, the CLI prints example JSON when run without args
- **Creatives can't be edited in-place** — `update-ad-text` creates a new creative and swaps it on the ad

---

## AI Lead Management Agent

The project includes a Python AI agent that manages YTT leads via Telegram. It lives in `lead-agent/` and runs 24/7 on a Mac Mini.

### Key Files

| File | Purpose |
|------|---------|
| `lead-agent/agent.py` | Main entry — Telegram bot + APScheduler + Firestore real-time listener |
| `lead-agent/knowledge.py` | Builds the agent's system prompt from project files + Firestore knowledge base |
| `lead-agent/scheduler.py` | Drip email/SMS sequence logic (5 steps over 10 days) |
| `lead-agent/monitor.py` | Uptime monitoring — startup/shutdown/error Telegram notifications |
| `lead-agent/tools/firestore.py` | Firestore CRUD — leads, drip status, notes, pipeline stats |
| `lead-agent/tools/email.py` | Email sending — welcome, drip templates, custom emails via Gmail |
| `lead-agent/tools/sms.py` | SMS via GatewayAPI |
| `lead-agent/tools/telegram.py` | Telegram bot helpers — send messages, inline keyboards |

### How It Works

1. **Firestore listener** watches the `leads` collection for new leads
2. **Telegram notifies** Shamir when a new lead arrives (with action buttons)
3. **Drip scheduler** (APScheduler) sends email/SMS sequences: Day 0, 2-3, 5, 7, 10
4. **Shamir chats** via Telegram to pause drips, update leads, send custom emails
5. **Claude API** (Anthropic) processes natural language commands with tool-use

### Dynamic Knowledge Base

The agent's system prompt is built from two sources:

1. **Static knowledge** — hardcoded in `knowledge.py` (business info, programs, workflow rules)
2. **Dynamic knowledge** — fetched from Firestore `agent_knowledge` collection at prompt build time

Admin manages dynamic knowledge via `/admin/` → **Knowledge** tab → 3 brand tabs (Yoga Bible, Hot Yoga CPH, Vibro Yoga). Each brand's sections are injected into the respective agent's system prompt.

**API:** `knowledge-admin.js` Netlify function (admin-auth protected CRUD)

**For future agents (HYC, Vibro):** Call `get_knowledge_for_brand('hot-yoga-cph')` from `knowledge.py` to get that brand's knowledge sections.

### Running the Agent

```bash
cd lead-agent
pip install -r requirements.txt
cp .env.example .env  # Fill in API keys
python agent.py           # Telegram bot mode
python agent.py --cli     # Terminal mode (testing)
python agent.py --daemon  # launchd daemon mode
```

### Daemon Setup (macOS)

Run `./install-daemon.sh` to create launchd plists for auto-start on boot:

1. **Agent daemon** (`com.yogabible.lead-agent`) — runs `agent.py --daemon`, auto-restarts on crash
2. **Auto-deploy daemon** (`com.yogabible.auto-deploy`) — checks GitHub every 5 min, pulls + restarts agent if code changed

```bash
# Check status
launchctl list | grep yogabible

# View logs
tail -f lead-agent/logs/agent-stderr.log   # Real-time errors
tail -f lead-agent/logs/auto-deploy.log    # Auto-deploy checks

# Manual restart
launchctl kickstart -k gui/$(id -u)/com.yogabible.lead-agent
```

### Agent Tools (35 total)

| Category | Tools |
|----------|-------|
| **Lead Management** | `get_new_leads`, `find_lead`, `update_lead_status`, `pause_lead_emails`, `resume_lead_emails`, `get_drip_info` |
| **Communication** | `send_custom_email`, `send_template_email`, `send_sms_message`, `schedule_email`, `schedule_sms` |
| **Pipeline** | `get_pipeline_stats`, `get_stale_leads` |
| **Appointments** | `get_upcoming_appointments`, `get_todays_appointments`, `find_appointment`, `get_pending_requests`, `confirm_appointment_request`, `cancel_appointment`, `reschedule_appointment`, `send_appointment_sms` |
| **System** | `read_project_file`, `get_recent_git_changes`, `refresh_knowledge` |

### Firestore Collections (Agent)

| Collection | Purpose |
|------------|---------|
| `leads` | Lead documents (email, name, phone, type, ytt_program_type, status, temperature, notes) |
| `lead_drip_sequences` | Drip tracking per lead (current_step, next_send_at, paused, completed) |
| `email_log` | Audit trail of every email sent (lead_id, to, subject, template_id, sent_at, status) |
| `appointments` | Bookings (date, time, client info, type, status, preferred_slots for photo sessions) |
| `agent_knowledge` | Admin-curated knowledge sections (brand, title, content, active, sort_order) |

### Drip Sequence

| Step | Day | Channel | Content |
|------|-----|---------|---------|
| 1 | 0 | Email | Welcome + schedule (sent by Netlify, agent skips) |
| 2 | 2-3 | Email + SMS | Social proof (500+ graduates, alumni quote) |
| 3 | 5 | Email | Investment framing (3750 DKK Preparation Phase) |
| 4 | 7 | Email + SMS | Urgency (limited spots) + booking CTA |
| 5 | 10 | Email | Personal final nudge (direct phone number) |

### Scheduled Jobs (APScheduler)

- **Drip scheduler** — every 60 min, sends due emails/SMS
- **Appointment reminders** — 18:00 evening briefing (tomorrow), 9:00 morning briefing (today + pending)
- **Daily heartbeat** — 9:00 AM uptime report + error summary

---

## SEO/AEO Monitoring Agent

Automated SEO health checks with Telegram notifications. Lives in `seo-agent/`.

### Key Files

| File | Purpose |
|------|---------|
| `seo-agent/agent.py` | Main entry — APScheduler daemon with weekly/daily checks |
| `seo-agent/checks.py` | Individual check functions (health, schema, prices, PageSpeed, Search Console) |
| `seo-agent/telegram_notify.py` | Telegram notification service |

### How It Works

- **Weekly full report** (Monday 8am CET): Site health, structured data, price consistency, PageSpeed, Search Console rankings, keyword monitoring
- **Daily quick check** (7am CET): Site health + price verification (silent unless issues found)
- Monitors 14 key pages (DA/EN homepage, YTT programs, journal, glossary, contact)
- Validates YTT pricing consistency across pages (23.750 DKK is correct price)
- Tracks 10 target keywords (Danish + English)

### Running

```bash
cd seo-agent
pip install -r requirements.txt
python agent.py           # Daemon mode (APScheduler)
python agent.py --once    # One-time report
```

---

## Scripts & Automation

Utility scripts in `scripts/` for DevOps tasks.

### Git Auto-Sync (`scripts/git-auto-sync.sh`)

Bidirectional sync between local (iCloud) repo and GitHub. Runs every 5 min via launchd.

- Safe fast-forward pulls + push for local changes
- Handles iCloud `.git` corruption (conflict files, stale index.lock)
- Lock file prevents concurrent syncs
- Retry with exponential backoff for network failures
- Config: `scripts/com.yogabible.git-sync.plist`

### Cloudinary Asset Optimizer (`scripts/cloudinary-optimize-assets.sh`)

Finds oversized images (>1MB) on Cloudinary and re-uploads optimized versions.

- Converts to JPG (keeps PNG for brand assets)
- Applies quality=85, scales to max 2400px
- Reports savings percentage per asset

### Cloudinary Storage Audit (`scripts/cloudinary-storage-audit.sh`)

Detailed audit: largest images/videos, unoptimized formats, storage per folder.

### Cloudinary Folder Creator (`scripts/cloudinary-create-missing-folders.sh`)

Creates the full Cloudinary folder structure (16 folders).

---

## Live Streaming System

Two-mode live streaming: one-way broadcast (Mux) + Zoom-style interactive (LiveKit).

### Architecture

| Component | Technology | Purpose |
|-----------|-----------|---------|
| One-way broadcast | Mux | Teacher → students via HLS player |
| Interactive mode | LiveKit | Group video call (camera, mic, raise hand, chat) |
| Panel mode | LiveKit | Multiple speakers + audience |
| Google Meet | External | Alternative for quick sessions |

### Key Files

| File | Purpose |
|------|---------|
| `src/js/live.js` | Student-facing viewer + interactive mode toggle |
| `src/js/live-admin.js` | Admin: schedule management, stream controls, Teacher Studio |
| `netlify/functions/live-admin.js` | Schedule CRUD + MindBody import |
| `netlify/functions/livekit-token.js` | LiveKit room creation + JWT tokens |
| `netlify/functions/mux-stream.js` | Browser-based Mux stream creation |
| `netlify/functions/mux-webhook.js` | Mux recording/asset webhooks |

### Stream Types

| Type | Description |
|------|-------------|
| `broadcast` | One-way (teacher → students via Mux HLS) |
| `interactive` | LiveKit group call (requires login, all participants have camera/mic) |
| `panel` | Expert panel with named speakers + audience |
| `google-meet` | External Google Meet link |

### AI Recording Processing Pipeline

After a live session ends, recordings are automatically processed via **Deepgram transcription** (not Mux auto-captions):

1. Mux webhook fires when recording asset is ready
2. `ai-process-recording-background` gets MP4 URL from Mux (via `master_access: "temporary"` download URL, or creates temp asset for live recordings)
3. Sends MP4 audio to **Deepgram Nova-2** (`/v1/listen`) with `utterances=true`, `detect_language=true`, `smart_format=true`
4. Generates VTT subtitles from Deepgram response, saves VTT to Firestore (`captionVtt` field)
5. Uploads VTT to Mux as subtitle track via `serve-vtt` function (Mux fetches the VTT URL)
6. Sends transcript to **Claude Sonnet 4.6** for summary + quiz generation
7. Saves everything to Firestore `live-schedule` document

**Status flow:** `aiStatus`: `preparing_audio` → `transcribing` → `uploading_subtitles` → `generating_summary` → `complete`

**Fields:** `aiStatus`, `aiError`, `aiSummary`, `aiSummaryLang`, `aiQuiz`, `aiTranscript`, `aiProcessedAt`, `captionVtt`, `captionLang`, `aiCaptionTrackId`

#### Key Implementation Details (Deepgram + Subtitles)

**Word-level fallback for VTT generation:** Deepgram can return a full transcript but an **empty utterances array** (especially for long recordings 3h+). The code handles this by building synthetic utterances from word-level timestamps in ~10-second chunks (`buildUtterancesFromWords()`). Without this fallback, the VTT generation silently skips and no subtitles appear on Mux. This was the root cause of a multi-week debugging effort — do NOT remove this fallback.

**VTT URL must use canonical domain:** The `serve-vtt` URL passed to Mux must use `https://yogabible.dk` (hardcoded), NOT `process.env.URL` which resolves to `www.yogabible.dk` and causes a 301 redirect. Mux does not follow redirects when ingesting subtitle tracks, so the upload silently fails.

**Deepgram API config:** Model `nova-2`, features: `detect_language`, `smart_format`, `paragraphs`, `utterances` (with `utt_split=0.8`). API key stored in Netlify env. ~$1.20 per 4.5h recording.

#### Retranscribe / Reprocess Sessions

Use `ai-backfill` function to retrigger processing for existing recordings:

```bash
# Single session (full pipeline: Deepgram → subtitles → Claude summary)
curl "https://yogabible.dk/.netlify/functions/ai-backfill?retranscribe=SESSION_ID&secret=AI_INTERNAL_SECRET"

# All sessions with recordings
curl "https://yogabible.dk/.netlify/functions/ai-backfill?retranscribe=all&secret=AI_INTERNAL_SECRET"

# Transcript only (skip Claude summary/quiz)
curl "https://yogabible.dk/.netlify/functions/ai-backfill?retranscribe=SESSION_ID&transcript-only=1&secret=AI_INTERNAL_SECRET"

# Check status of all sessions
curl "https://yogabible.dk/.netlify/functions/ai-backfill?debug=1&secret=AI_INTERNAL_SECRET"

# Check MP4 rendition status
curl "https://yogabible.dk/.netlify/functions/ai-backfill?mp4-status=1&secret=AI_INTERNAL_SECRET"
```

**What retranscribe does:** Deletes old Mux subtitle tracks → resets Firestore AI fields → triggers `ai-process-recording-background` as a new invocation. Each session runs as a separate background function (15-min timeout).

**Troubleshooting stuck sessions:** If `aiStatus` is stuck at `transcribing`, the Deepgram call likely timed out (504). Just retrigger with the same curl. Check Deepgram dashboard (console.deepgram.com → Usage → Logs) to see if the request completed (200 OK) or failed. Dashboard times are UTC.

#### Key Files

| File | Purpose |
|------|---------|
| `netlify/functions/ai-process-recording-background.js` | Main pipeline: MP4 → Deepgram → VTT → Mux subtitles → Claude summary |
| `netlify/functions/ai-backfill.js` | Admin tool: debug, retranscribe, MP4 status, subtitle management |
| `netlify/functions/serve-vtt.js` | Serves VTT from Firestore for Mux to ingest |
| `netlify/functions/mux-webhook.js` | Triggers pipeline when recording asset is ready |

---

## Purchase Funnel Tracking

Multi-stage funnel analytics for YTT and course purchases.

### Funnel Stages

| Stage | Trigger |
|-------|---------|
| `cta_click` | User clicks CTA button |
| `auth_complete` | User logs in or registers |
| `profile_complete` | User fills phone + DOB |
| `checkout_opened` | Checkout modal shown |
| `purchased` | Payment complete |
| `checkout_abandoned` | Modal closed without purchase |

### Key Files

| File | Purpose |
|------|---------|
| `src/js/ytt-funnel.js` | Funnel stage tracking + GA DataLayer pushes |
| Firestore `lead_funnel` | `{userId}_{prodId}` documents with full history array |

### URL Parameter Support

The checkout flow supports `?product=100078` URL parameters to auto-open the checkout modal for a specific product. Useful for direct payment links in emails and SMS.

---

## Store & Checkout System

### Terminology (MANDATORY)

**IMPORTANT:** The YTT initial payment is called **"Preparation Phase" / "Forberedelsesfasen"** — NEVER "deposit" or "depositum" in user-facing text. Internal code may still use `deposits` as a subcategory ID and `isDeposit` as a variable name, but all visible labels, descriptions, buttons, and info text must use the Preparation Phase terminology.

| Context | Danish | English |
|---------|--------|---------|
| Badge on store card | Forberedelsesfasen | Preparation Phase |
| Buy button | Start forberedelsesfasen | Start Preparation Phase |
| Category description | Forberedelsesfasen og tilmelding til uddannelse | Preparation Phase and training enrollment |
| Item descriptions | Start din forberedelsesfase for... | Begin your Preparation Phase for... |

### Store Catalog Structure

The store catalog lives in `src/js/profile.js` as the `storeCatalog` object with age-bracket pricing (`over30` / `under30`). Categories:

| Top Category | Subcategories | Item Type |
|-------------|---------------|-----------|
| `daily` | `memberships`, `timebased`, `clips`, `trials`, `tourist` | `service` or `contract` |
| `teacher` | `deposits` (internal ID) | `service` |
| `courses` | `individual`, `bundle` | `service` |
| `workshops` | — | `service` |
| `private` | — | `service` |

Each catalog item can have: `name_da`, `name_en`, `desc_da`, `desc_en`, `features_da`, `features_en`, `period_da`, `period_en`, `format_da`, `format_en`, `price`, `prodId`, `vat_pct`.

### Checkout Item Display

When `openCheckout()` renders the checkout item, it shows contextual details based on product type:

- **Teacher Training (Preparation Phase):** "Forberedelsesfasen" + period chip, format, description, benefits checklist (5 items), remaining payment info note
- **Course Bundles:** Month chip, individual course descriptions, discount savings, bonus pass highlight (for 3-course All-In)
- **Single Courses:** Month chip, course description
- **Memberships:** Feature checklist, first-month-free savings, terms list
- **Generic items:** Description text from `desc_da`/`desc_en`

The **remaining payment note** for teacher training reads:
- DA: *"Restbeløbet afregnes inden uddannelsesstart — enten som engangsbeløb eller i rater. Din uddannelsesleder vil kontakte dig med alle detaljer og næste skridt."*
- EN: *"The remaining balance is settled before training starts — either in full or in instalments. Your course director will be in touch with all the details and next steps."*

### Checkout CSS Classes

| Class | Purpose |
|-------|---------|
| `.yb-store__checkout-meta` | Flex row for chips (period, phase label) |
| `.yb-store__checkout-meta-chip` | Orange pill badge (e.g., "Forberedelsesfasen", "April 2026") |
| `.yb-store__checkout-meta-format` | Muted format text (e.g., "200-timers komplet uddannelse") |
| `.yb-store__checkout-desc` | Gray description paragraph |
| `.yb-store__checkout-features` | Green-checkmark feature list |
| `.yb-store__checkout-remaining` | Gray info note with icon (remaining payment) |
| `.yb-store__checkout-bonus` | Orange bonus highlight (e.g., free pass) |
| `.yb-store__checkout-saving` | Green savings badge |

### Store Card Layout for Deposit Items

Deposit/teacher training cards use `.yb-store__item--deposit` which stacks the footer vertically (price row + full-width button below) to accommodate the longer CTA text.

### Waiver System

The liability waiver check uses a 3-tier strategy:
1. **localStorage** (synchronous, instant on page load)
2. **Firestore consents collection** (async, reliable audit trail)
3. **MindBody API** (async, external source of truth)

`hideCheckoutWaiverIfSigned()` is called when async checks confirm the waiver is already signed — it auto-hides the waiver section in an already-open checkout, updates the agree label, and removes the split grid if no documents remain. This prevents the waiver from showing to users who have already signed it.

### Dual-Site Parity

All store/checkout changes must be applied to **both** sites:
- **Yoga Bible:** `src/js/profile.js` + `src/css/main.css`
- **Hot Yoga CPH:** `hot-yoga-cph/public/js/profile.js` + `hot-yoga-cph/public/css/profile.css`

### Checkout Flow Modal (Multi-Step Popup)

The checkout flow modal replaces the old "auth modal → redirect to profile store" funnel with a single popup that handles everything: auth → registration → product breakdown → payment → success redirect.

#### Architecture

| File | Purpose |
|------|---------|
| `src/_includes/modal-checkout-flow.njk` | Modal HTML — 4 steps in one `<div>`, shown/hidden by JS |
| `src/js/checkout-flow.js` | All modal logic: auth, MB client, stored card, payment, step navigation |
| `src/js/ytt-funnel.js` | Entry point — `startCheckoutFunnel(prodId)` calls `openCheckoutFlow(prodId)` |
| `src/css/main.css` | Styles prefixed `ycf-` (step dots, product badge, product card, payment radio, back link) |
| `src/_includes/base.njk` | Includes the modal HTML + JS on every page (after `modal-checkout.njk`, before Firebase SDK) |

#### How It Works — Step by Step

1. **CTA button** anywhere on the site has `data-checkout-product="100121"` (or `onclick="startCheckoutFunnel('100121')"`)
2. `ytt-funnel.js` intercepts → saves funnel data to sessionStorage → calls `window.openCheckoutFlow(prodId)`
3. **checkout-flow.js** opens the modal:
   - If user is **already logged in** → skip to Step 3 (checkout), resolve MB client + check stored card in background
   - If user is **not logged in** → show Step 1 (login)

**Step 1 — Login:** Login form + product preview badge (name, price, cohort, description). Links to "Create profile" (Step 2) and "Forgot password" (Step 1b).

**Step 2 — Register:** First name, last name, email, phone, password + consent checkboxes. On submit: creates Firebase account → **immediately creates Mindbody client** (triggers welcome email) → advances to Step 3.

**Step 3 — Checkout:** Product breakdown card (name, price, chips for phase/period/format, description, remaining payment note for YTT). If user has a stored card on file: radio toggle "Use saved card (Visa •••• 4242)" vs "Enter new card". Card fields hidden when stored card selected. Payment via `mb-checkout` API.

**Step 4 — Success:** Confirmation message → "Go to your profile" button → redirects to `/profile#passes` where the unsigned waiver card is waiting.

#### Key Behaviors

- **MB client created immediately after auth** (not at payment time) — this triggers the Mindbody welcome email for new users
- **Stored card detection:** After auth, fetches `GET /.netlify/functions/mb-client?action=storedCard&clientId={id}`. If found, shows radio toggle; payment sends `{ useStoredCard: true, lastFour: '4242' }`
- **Card saving:** New card payments always include `saveCard: true` in the payment payload, so Mindbody stores the card on the client's profile for future purchases. The backend (`mb-checkout.js`) passes this as `saveInfo: "true"` to the Mindbody API.
- **Back navigation:** Register step has "Tilbage" → login. Checkout step has "Tilbage" → whichever auth step the user came from (`authOriginStep` state). Hidden when user was already logged in.
- **ytt-funnel.js auth listener** checks if `ycf-modal` is open before redirecting — prevents conflict between the two systems
- **Step indicator:** 3 dots connected by lines, progressively filled orange as user advances

#### Product Catalog

The `PRODUCTS` object in `checkout-flow.js` contains all CTA-purchasable items with: `price`, `name_da/en`, `period_da/en`, `format_da/en`, `desc_da/en`, `category`. **This must be kept in sync with `storeCatalog` in `profile.js`** when products are added/changed.

Current products:
- **Teacher Training (5):** 100078, 100121, 100211, 100209, 100210 — all 3750 DKK (Preparation Phase)
- **300h Advanced:** 100212 — 5750 DKK
- **Courses (3):** 100145 (Inversions), 100150 (Splits), 100140 (Backbends) — all 2300 DKK
- **Course Bundles (4):** 119, 120, 121 (2-course combos), 127 (All-In 3-course + free 1-month pass)
- **Workshop (1):** 100075 — 975 DKK (individual YTT workshop pass, redirects to `/weekly-schedule/?filter=ytt`)

**Active YTT Cohorts (as of March 2026):**
- 100078 — 4-Week Intensive (April 2026)
- 100121 — 8-Week Semi-Intensive (April–May 2026)
- 100211 — 4-Week Vinyasa Plus (July 2026, 70% Vinyasa / 30% Yin + Hot Yoga)
- 100209 — 18-Week Flexible (April–August 2026)
- 100210 — 18-Week Flexible (August–December 2026)

**WARNING:** `ytt-funnel.js` line 33 contains a test product (`100203: Test Klippekort`) marked "REMOVE before production". Do NOT use in live checkout flows.

#### CSS Class Prefix

All checkout flow modal styles use the `ycf-` prefix:

| Class | Purpose |
|-------|---------|
| `.ycf-box` | Modal box override (max-width: 460px) |
| `.ycf-steps`, `.ycf-steps__dot`, `.ycf-steps__line` | Step indicator dots + connecting lines |
| `.ycf-step` | Step panel (fade-in animation) |
| `.ycf-product-badge` | Product preview card on login step (name, price, cohort, description) |
| `.ycf-product` | Full product breakdown card on checkout step |
| `.ycf-chip`, `.ycf-chip--brand`, `.ycf-chip--muted` | Small pill badges (phase, period, format) |
| `.ycf-payment-methods`, `.ycf-payment-option` | Stored vs new card radio toggle |
| `.ycf-back` | Back navigation link with arrow icon |

#### Bilingual Pattern

Uses the same `data-yj-da` / `data-yj-en` attribute pattern as the rest of the site. The JS uses `isDa = window.location.pathname.indexOf('/en/') !== 0` and a `t(da, en)` helper for dynamic text.

#### Replicating for Hot Yoga CPH

To build the same modal for the Hot Yoga CPH site:

1. **Copy** `modal-checkout-flow.njk` to the HYC templates directory
2. **Copy** `checkout-flow.js` to `hot-yoga-cph/public/js/checkout-flow.js`
3. **Adapt the PRODUCTS object** — update prodIds, prices, names, periods to match HYC's catalog
4. **Adapt the brand color** — replace `var(--yb-brand)` references with `#3f99a5` in the CSS (or use HYC's CSS variable)
5. **Copy the `ycf-` CSS block** from `main.css` to `hot-yoga-cph/public/css/profile.css` (or wherever HYC styles live)
6. **Include** the modal HTML + JS in HYC's base template
7. **Wire up** `ytt-funnel.js` equivalent (or a simpler direct call to `openCheckoutFlow(prodId)`) on HYC CTA buttons
8. **API endpoints** are the same (`/.netlify/functions/mb-*`) — just ensure the HYC site ID is configured in the backend

---

## Cloudinary Media Management (MANDATORY)

**IMPORTANT:** All media assets are hosted on Cloudinary (`ddcynsa30`). When creating a new page, you MUST also create the corresponding Cloudinary folder. This is not optional.

### Account Details

- **Cloud Name:** `ddcynsa30`
- **Base URL:** `https://res.cloudinary.com/ddcynsa30`
- **API Key:** `617726211878669`
- **API Secret:** `n90Ts-IUyUnxwNdtQd9i64d6Gtw`

### Folder Structure

All folders live under the root `yoga-bible-DK/`. The current structure:

```
yoga-bible-DK/
├── brand/            ← logos, favicons, brand assets
├── homepage/         ← homepage hero, sections
├── studio/           ← studio facility photos (hot room, main room)
├── location/         ← venue/location photos
├── courses/          ← course hero images
│   ├── inversions/   ← inversions course specific
│   ├── backbends/    ← backbends course specific
│   └── splits/       ← splits course specific
├── programs/         ← program pages
│   ├── p4w/          ← 4-week program (accommodation, certificates)
│   ├── p8w/          ← 8-week semi-intensive program
│   ├── p18w/         ← 18-week flexible program
│   └── om200/        ← about 200-hour YTT overview
├── accommodation/    ← student housing photos
├── concepts/         ← concept pages
│   ├── hotyoga/      ← Hot Yoga CPH images & videos
│   ├── namaste/      ← Namasté Online/Studios images & videos
│   └── vibro/        ← Vibro Yoga images & videos
├── copenhagen/       ← Copenhagen lifestyle & location photos
├── careers/          ← career/team images
├── apply/            ← application page images
├── compare/          ← teacher comparison avatars
├── mentorship/       ← mentorship page images
├── link/             ← link page hero & video
├── schedule/         ← schedule page shared assets
├── schedule-pages/   ← variant-specific schedule images
│   ├── 4w/           ← 4-week schedule hero/OG
│   ├── 8w/           ← 8-week schedule hero/OG
│   ├── 18w/          ← 18-week schedule hero/OG
│   └── 4w-jul/       ← 4-week July schedule hero/OG
├── member/           ← member area images
├── journal/          ← blog post featured images
├── materials/        ← course materials (doc-admin browser)
├── tutorials/        ← video tutorial assets
│   └── homepage/     ← homepage tutorial videos
├── yogamusic/        ← yoga music page videos & posters
└── yogaphotography/  ← photography page images
    └── models/       ← model showcase photos
```

### Auto-Create Cloudinary Folder for New Pages (MANDATORY)

When creating a new page on this site, you MUST create a corresponding Cloudinary folder using this curl command:

```bash
curl -s -X POST "https://api.cloudinary.com/v1_1/ddcynsa30/folders/yoga-bible-DK/{page-name}" \
  -u "617726211878669:n90Ts-IUyUnxwNdtQd9i64d6Gtw"
```

**For pages with sub-sections**, create nested folders:

```bash
# Parent folder
curl -s -X POST "https://api.cloudinary.com/v1_1/ddcynsa30/folders/yoga-bible-DK/{page-name}" \
  -u "617726211878669:n90Ts-IUyUnxwNdtQd9i64d6Gtw"

# Sub-folder
curl -s -X POST "https://api.cloudinary.com/v1_1/ddcynsa30/folders/yoga-bible-DK/{page-name}/{sub-section}" \
  -u "617726211878669:n90Ts-IUyUnxwNdtQd9i64d6Gtw"
```

**Naming rules:**
- Folder names: lowercase, hyphens for spaces (e.g., `teacher-training`)
- Match the page slug used in the site URL
- Nest sub-sections under the parent page folder

### Using Cloudinary in Templates

**Filters** (for URLs only — use inside `src`, `href`, `background-image`):

```nunjucks
{# Basic optimized image URL #}
{{ "yoga-bible-DK/homepage/hero" | cloudimg }}

{# With custom transforms #}
{{ "yoga-bible-DK/homepage/hero" | cloudimg("w_800,h_600,c_fill") }}

{# Video URL #}
{{ "yoga-bible-DK/homepage/hero-loop" | cloudvid }}
```

**Shortcodes** (for full responsive `<img>` / `<video>` tags):

```nunjucks
{# Responsive image with srcset (1x + 2x DPR) #}
{% cldimg "yoga-bible-DK/homepage/hero", "Alt text", "w_800,c_fill", "800", "600" %}

{# Autoplay looping video with poster #}
{% cldvid "yoga-bible-DK/courses/inversions-reel", "yoga-bible-DK/courses/inversions-poster", "w_1280" %}
```

**Common transform strings:**
- `w_800,h_600,c_fill` — Crop to exact size
- `w_1200,c_scale` — Scale to width, auto height
- `w_600,ar_16:9,c_fill` — Fill to aspect ratio
- `f_auto,q_auto` — Auto format + quality (applied by default)

### Cloudinary Path Convention

When referencing images in templates, always use the Cloudinary path (not local):

| Local placeholder path | Cloudinary path |
|----------------------|-----------------|
| `/assets/images/brand/*` | `yoga-bible-DK/brand/*` |
| `/assets/images/homepage/*` | `yoga-bible-DK/homepage/*` |
| `/assets/images/studio/*` | `yoga-bible-DK/studio/*` |
| `/assets/images/courses/*` | `yoga-bible-DK/courses/*` |
| `/assets/images/concepts/hotyoga-*` | `yoga-bible-DK/concepts/hotyoga/*` |
| `/assets/images/concepts/namaste-*` | `yoga-bible-DK/concepts/namaste/*` |
| `/assets/images/concepts/vibro-*` | `yoga-bible-DK/concepts/vibro/*` |
| `/assets/images/copenhagen/*` | `yoga-bible-DK/copenhagen/*` |
| `/assets/images/accommodation/*` | `yoga-bible-DK/accommodation/*` |
| `/assets/images/journal/*` | `yoga-bible-DK/journal/*` |
| `/assets/images/p4w/*` | `yoga-bible-DK/programs/p4w/*` |

### Workflow Checklist for New Pages

When you create a new page, follow this order:

1. Create Cloudinary folder(s) via curl (see above)
2. Create the page files (i18n JSON, template, DA/EN wrappers)
3. Use `cloudimg`/`cldimg` filters/shortcodes for all images in the template
4. Use `cloudvid`/`cldvid` for any videos
5. Add placeholder comments noting required image specs:
   ```html
   {# CLOUDINARY: yoga-bible-DK/pagename/hero.jpg — 1920x900, dark cinematic #}
   ```
6. Build with `npx @11ty/eleventy` to verify

---

## Unified Design System (MANDATORY)

**IMPORTANT:** When building or modifying ANY page on this site, you MUST use ONLY the approved components from `/samples/` (`src/samples.njk`). Do NOT invent new styles, patterns, or components. Reference the design system by section number and name.

### Brand Identity

- **Font:** Abacaxi Latin (`'Abacaxi'`) — Regular (400) + Bold (700). Used for ALL text globally. Fallback: `"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif`
- **Primary Color:** `#f75c03` (Brand Orange) — CTAs, accents, hover states
- **Brand Dark:** `#d94f02` — Hovers, gradients
- **Brand Light:** `#ff9966` — Gradients, accents
- **Hot Yoga CPH Color:** `#3f99a5` — Use ONLY for Hot Yoga Copenhagen topics (CTAs, frames, strokes, round elements)
- **Black:** `#0F0F0F` — Text, dark backgrounds
- **Muted:** `#6F6A66` — Secondary text
- **Border:** `#E8E4E0` — Dividers, borders
- **Light BG:** `#F5F3F0` — Section backgrounds
- **Warm White:** `#FFFCF9` — Cards, light sections

### Approved Components (by section in `/samples/`)

| # | Component | Usage Notes |
|---|-----------|-------------|
| 1 | **Colors** | Use only the approved palette above. Hot Yoga CPH color only for Hot Yoga topics. |
| 2 | **Typography** | Abacaxi Latin only. Hero/Section/Card/Body/Eyebrow sizes defined in samples. |
| 3 | **Buttons** | Primary (orange), Secondary (black), Outline, Ghost, Outline-Light (dark BG). Pill/Icon shapes. Shimmer + Gradient Border for special. |
| 4 | **Cards** | Hover effects: Lift, Border, Glow. **3D Tilt only for special offers.** Testimonial cards use orange stroke border. |
| 5 | **Hover Effects** | ONLY use: Lift, Glow, Background, Invert, Underline, Fill Up. No others. |
| 6 | **Animations** | ONLY use: Pulse, Bounce, Breathe. Use sparingly. |
| 7 | **Scroll-Triggered** | Fade Up, Slide Left/Right, Scale In, Staggered Children. Use where relevant. |
| 8 | **Parallax & Scroll** | Horizontal Scroll Gallery, Sticky Elements. |
| 9 | **Apple-Style Effects** | Large Gradient Title, Blur Reveal, Marquee/Ticker. |
| 10 | **Backgrounds** | ONLY: Solid Brand, Solid Dark, Gradient H, Animated. No others. |
| 11 | **Section Layouts** | Split Dark/Light, Split Brand/Light, Asymmetric, Overlap. |
| 12 | **Eyebrows** | Brand, With Line, With Dot. No others. Badge Style belongs in badges. |
| 13 | **Badges & Tags** | Primary, Secondary, Outline, Muted, Success, Warning, Pill, Badge Eyebrow. |
| 14 | **Forms** | Orange-stroke rounded inputs (12px radius, 1px solid brand orange). Two-column grid layout. Label above field. Newsletter form for CTAs. Match the modal form style. |
| 15 | **Accordions** | Separate rounded items (light gray bg), orange circle + icon on right. NOT connected bordered style. |
| 16 | **Tabs** | Underline, Pills, Buttons. |
| 17 | **Lists** | Checkmarks, Numbers, Arrows. |
| 18 | **Quotes** | 5 variations: Default (left mark), Dark Cinematic, Brand Gradient, Side Bar, Centered. |
| 19 | **Timeline** | Two variations: Compact (small dots) and Full Journey (SKRIDT labels, large dots). |
| 20 | **Dividers** | Default, Thick Brand, Gradient, Dashed, Dots. |
| 25 | **Reviews** | Orange stroke cards, 3-column layout, stars + quote + avatar. |
| 26 | **Pricing/Format** | Three variations: Accordion (expandable rows), Side-by-Side Cards, Comparison Table (orange header). |
| 27 | **Navigation Arrows** | Circle Outline, Circle Filled, Square, Pill, Ghost (dark BG), Minimal. |
| 28 | **Section Layout Variations** | Content+Video, Image Mosaic, Content+Looping Visual, Full-Width Overlay, Three-Column Features. |
| 29 | **Hero Sections** | 4 unified styles: Centered Clean, Split with Image, Dark Cinematic, Asymmetric with Stats Bar. |
| 30 | **Scroll-Draw Paths** | SVG vine/branch paths that draw on scroll. 5 variations: Flowing Vine + Shadow, Keyword-Touching Vine, Vine with Growing Leaves, Gentle S-Curve, Progress Line. Use sparingly as decorative accents. Variation B flows toward keywords on the page. Variation C has growing leaves. All SVGs must use `fill="none"` and `preserveAspectRatio="xMidYMid meet"`. |
| 31 | **Photography Page Layouts** | Designed for the yoga photography page. A: Dark Cinematic Photo Hero (full-bleed, text bottom-left). B: Big Picture + Text Split (60/40 image/text). C-E: Art Grids — creative, rule-breaking photo layouts (Bleed Right, Overlap, Diagonal Flow). Use dark backgrounds. |
| 32 | **Model Showcase** | 3 variations for presenting yoga models/photographers. Each includes: name, bio, social links, portrait photo, featured yoga photos. A: Classic Three-Column (portrait left, info center, gallery right). B: Hero Portrait Top (wide portrait + gradient overlay, info + photos below). C: Side-by-Side Editorial (portrait with name overlay left, asymmetric gallery right). |

### Design Rules

1. **Never invent new component styles** — always reference `/samples/`
2. **Forms must use orange-stroke inputs** with 12px border-radius, matching the modal design
3. **Accordions must be separate rounded items** — not connected bordered blocks
4. **3D tilt effect is reserved for special offers only**
5. **Animations (Pulse/Bounce/Breathe) should be used rarely** — not on every element
6. **Hot Yoga CPH color `#3f99a5`** is only used for Hot Yoga Copenhagen content — never for general Yoga Bible branding
7. **All hero sections should follow one of the 4 approved hero patterns** from section 29 for cross-page consistency
8. **Review/testimonial cards always have orange stroke border** (`1.5px solid var(--yb-brand)`)
9. **Pricing comparison tables use orange header bar** — not black
10. **Photography page uses dark cinematic layouts** from section 31 — dark backgrounds, editorial grids
11. **Model showcase cards** must include: name, bio, social links, 1 portrait + featured yoga photos — use section 32 variations
12. **Scroll-draw vines** are a brand element — use across landing pages for visual storytelling. Variation B should be custom-pathed to touch keywords on each specific page
