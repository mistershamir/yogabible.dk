# CLAUDE.md Archive — Detailed Reference

> This file contains detailed reference content removed from CLAUDE.md to reduce its size.
> These sections are still accurate but were too verbose for the main instructions file.
> Last archived: 2026-04-13

---

## Nurture Sequence Content Tables

### Broadcast Sequence Content (Evergreen)

No dates, no specific cohort references — works for any enrollment period.

| Step | Delay | DA Subject | EN Subject | Theme |
|------|-------|-----------|------------|-------|
| 1 | 2 days | 20 mennesker sagde ja | 20 people said yes | Social proof / seed |
| 2 | +5 days | Du behøver ikke kunne stå på hovedet | You don't need to touch your toes | Kill fear / Prep Phase intro |
| 3 | +5 days | Det her er ikke et yoga retreat | This isn't a yoga retreat | Differentiation / Triangle Method + video |
| 4 | +6 days | Hvilken passer til dit liv? | Which one fits your life? | Self-select format |
| 5 | +5 days | Det smarteste første skridt | The smartest first step | Prep Phase deep dive |
| 6 | +5 days | Din plads venter | Your spot is waiting | Convert |

### Onboarding Sequence Content (Undecided Leads)

| Step | Delay | DA Subject | EN Subject |
|------|-------|-----------|------------|
| 1 | 3 days | {{first_name}}, der er sket en del | {{first_name}}, a lot has been happening |
| 2 | +2 days | Hvilken uddannelse passer til dig? | Which education fits you? |
| 3 | +2 days | "Jeg troede ikke det var noget for mig" | "I didn't think it was for me" |
| 4 | +3 days | Hvad holder dig tilbage? | What's holding you back? |
| 5 | +2 days | Stadig her hvis du har brug for mig | Still here if you need me |

Steps 2, 4, 5 include booking link: `yogabible.dk/?booking=info-session` (DA) / `yogabible.dk/en/?booking=info-session` (EN)

### Program-Specific Sequence Content

**April 4W** (2 steps): Step 1 "stadig interesseret?" → Step 2 "de sidste pladser"

**8W Semi** (3 steps): Step 1 "Samme certificering, halv tid" → Step 2 "Din hverdag behøver ikke stoppe" → Step 3 "Maj nærmer sig"

**18W Flexible** (3 steps): Step 1 "Marts-holdet er udsolgt" → Step 2 "Hverdag eller weekend" → Step 3 "Start din forberedelse"

**July Vinyasa Plus** (4 steps): Step 1 "Din sommer i København" → Step 2 "Vinyasa Plus metoden" → Step 3 "Vi hjælper med det praktiske" → Step 4 "Juli-holdet fylder op"

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

### Audit & Fix Endpoints

All protected by `X-Internal-Secret` header (`AI_INTERNAL_SECRET` env var).

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/.netlify/functions/audit-sequences` | GET | Full Firestore state: all sequences, enrollments, content status, language scan |
| `/.netlify/functions/fix-sequences` | POST | Update exit conditions, fix channel mismatches |
| `/.netlify/functions/fix-english-urls` | POST | Add `/en/` prefix to all `yogabible.dk` URLs in `email_body_en` fields |
| `/.netlify/functions/scan-sequence-language` | POST | Find and remove "taught in English" / "undervises på engelsk" references |
| `/.netlify/functions/fix-sms-and-quickfollowup` | POST | Remove refund language from SMS, add EN to Quick Follow-up |

### Nurture Sequence Key Files (Full List)

| File | Purpose |
|------|---------|
| `netlify/functions/process-sequences.js` | Cron processor (runs `*/30 * * * *`) — sends due emails/SMS |
| `netlify/functions/shared/sequence-trigger.js` | Enrolls leads into sequences on form submission |
| `netlify/functions/audit-sequences.js` | GET endpoint — full Firestore state audit |
| `netlify/functions/fix-sequences.js` | POST endpoint — fix exit conditions, channel mismatches |
| `netlify/functions/fix-english-urls.js` | POST endpoint — add `/en/` prefix to EN email URLs |
| `netlify/functions/scan-sequence-language.js` | POST endpoint — find/remove course language references |
| `netlify/functions/fix-sms-and-quickfollowup.js` | POST endpoint — fix SMS refund language, add EN to Quick Follow-up |
| `netlify/functions/seed-july-international-sequence.js` | One-time: create July International Conversion sequence with placeholder steps |
| `netlify/functions/populate-july-international-content.js` | Populate July International steps from `data/july-international-content.json` |
| `src/js/sequences-admin.js` | Admin UI for sequence management |
| `src/js/nurture-admin.js` | Admin UI for nurture monitoring |

---

## Planned: Educational/Lifestyle Nurture Sequence (4th Layer)

**Status:** Content designed, first 4 emails drafted, NOT yet built in Firestore.

**Design:** 12 emails, weekly cadence (10,080 min delay), auto-enrolls when broadcast completes.

**Key innovation — DA and EN have different angles:**
- **DA:** Practical, "this is viable in Denmark", DKK earnings, local market
- **EN:** Aspirational, "imagine your life in Copenhagen", destination dream + practical proof

**Planned innovation — Country-specific snippets:** Each EN email gets a `{{country_block}}` paragraph that changes based on lead's country (Norway, Sweden, Germany, Finland, Netherlands, UK). Includes local currency earnings, flight time/cost to Copenhagen, country-specific angles, and cost-of-living comparison.

**12-email arc:**

| # | Topic | DA Angle | EN Angle | Type |
|---|-------|----------|----------|------|
| 1 | Money | What yoga teachers earn in DK | The global yoga economy + local earnings | Dream |
| 2 | Revenue streams | 3 ways to build income | Build a location-independent career | Business |
| 3 | Student story | "Jeg sagde mit job op" | "I flew to Copenhagen and everything changed" | Story |
| 4 | Soft CTA | Døren er åben | Your Copenhagen chapter is waiting | Nudge |
| 5 | Hot yoga | Hot yoga booming in Scandinavia | Hot yoga cert: the skill most teachers don't have | Differentiator |
| 6 | Studio ownership | How to open a studio in DK | From training to your own studio | Dream big |
| 7 | Day in the life | A Tuesday as a yoga teacher in CPH | 24 hours in Copenhagen as a YTT student | Lifestyle |
| 8 | Soft CTA | Start when you're ready | This summer could be the one | Nudge |
| 9 | Wellness angle | Teaching changed my relationship with my body | The transformation nobody warns you about | Personal |
| 10 | Industry growth | Scandinavian yoga market exploding | Why CPH is becoming Europe's yoga capital | Industry |
| 11 | The certification | What RYT-200 means for your career | A certification that works anywhere | Practical |
| 12 | Final CTA | Din plads venter | See you in Copenhagen | Convert |

**Timing:** First leads complete broadcast ~April 14. Build and deploy by April 10. Do NOT launch while broadcast is active — 91% of leads would hit 48h throttle conflicts.

---

## Lead Behavior Tracking — Detailed Implementation

### How Each Layer Works

**Schedule Tracking (tokenized links):**
1. `lead.js` generates HMAC-SHA256 token from `leadId:email` using `UNSUBSCRIBE_SECRET`
2. Welcome emails include `?tid=LEAD_ID&tok=TOKEN` on schedule URLs
3. `sequences.js` auto-injects tokens into any schedule URL in nurture emails via `injectScheduleTokens()`
4. `schedule-track.js` (client) fires pageview/heartbeat/leave events to `schedule-visit.js`
5. Stored in `leads/{id}.schedule_engagement` and `schedule_visits/{tid}_{slug}` collection

**Email Engagement (pixel + click tracking):**
1. `prepareTrackedEmail(html, leadId, source)` injects a 1x1 tracking pixel and wraps all links
2. Pixel loads → `email-track.js?t=open&lid=LEAD_ID` → logs open on lead doc
3. Link click → `email-track.js?t=click&lid=LEAD_ID&url=...` → logs click, sets `yb_lid` cookie (1 year), redirects
4. Stored in `leads/{id}.email_engagement { total_opens, total_clicks, last_opened, last_clicked, opens[], clicks[] }`

**Website Behavior (cookie-based):**
1. `yb_lid` cookie set when lead clicks any tracked email link
2. `site-track.js` (loaded on every page via `base.njk`) reads cookie, sends events to `site-visit.js`
3. Tracks: pageviews, scroll depth (%), time on page (30s heartbeats), CTA clicks, sessions
4. Auto-detects interests from page categories (schedule, pricing, 4-week, 8-week, etc.)
5. Stored in `leads/{id}.site_engagement { total_pageviews, total_sessions, total_time_seconds, pages{}, interests[], cta_clicks[] }`

### Re-Engagement Detection

Both `email-track.js` and `site-visit.js` check `lead.last_activity` on every event:
- If the lead has been inactive for **7+ days** and returns → sets `re_engaged: true` + logs event
- `re_engagement_events[]` stores: trigger type, days inactive, detail (page/URL), timestamp
- Admin panel shows re-engaged badge next to re-engaged leads

### Admin Panel Engagement Badges

- Schedule engagement (green = 3+ visits & 75%+ scroll, yellow = 2+ visits or 50%+ scroll)
- Email engagement (green = 3+ clicks, yellow = 1+ click or 3+ opens)
- Site browsing (blue = 3+ pageviews)
- Re-engaged (orange = came back after 7+ days silence)

### Firestore Schema (Lead Doc Fields)

```
leads/{id}:
  schedule_token: "hex..."
  schedule_engagement:
    total_visits: number
    last_visit: Timestamp
    last_page: string
    pages:
      {slug}: { visit_count, last_visit, max_scroll, total_seconds }
  email_engagement:
    total_opens: number
    total_clicks: number
    last_opened: Timestamp
    last_clicked: Timestamp
    opens: [{ at, src }]
    clicks: [{ url, at, src }]
  site_engagement:
    total_pageviews: number
    total_sessions: number
    total_time_seconds: number
    first_visit: Timestamp
    last_visit: Timestamp
    pages:
      {slug}: { views, last_visit, path, max_scroll, total_seconds }
    interests: ["teacher-training", "4-week", "pricing", ...]
    cta_clicks: [{ text, href, page, at }]
  last_activity: Timestamp
  re_engaged: boolean
  re_engaged_at: Timestamp
  re_engagement_events: [{ at, trigger, detail, days_inactive }]
```

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

## AI Lead Agent — Detailed Reference

### Agent Tools (35 total)

| Category | Tools |
|----------|-------|
| **Lead Management** | `get_new_leads`, `find_lead`, `update_lead_status`, `pause_lead_emails`, `resume_lead_emails`, `get_drip_info` |
| **Communication** | `send_custom_email`, `send_template_email`, `send_sms_message`, `schedule_email`, `schedule_sms` |
| **Pipeline** | `get_pipeline_stats`, `get_stale_leads` |
| **Appointments** | `get_upcoming_appointments`, `get_todays_appointments`, `find_appointment`, `get_pending_requests`, `confirm_appointment_request`, `cancel_appointment`, `reschedule_appointment`, `send_appointment_sms` |
| **System** | `read_project_file`, `get_recent_git_changes`, `refresh_knowledge` |

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

---

## Live Streaming — Detailed Reference

### AI Recording Processing Pipeline (Full Details)

After a live session ends, recordings are automatically processed via **Deepgram transcription** (not Mux auto-captions):

1. Mux webhook fires when recording asset is ready
2. `ai-process-recording-background` gets MP4 URL from Mux (via `master_access: "temporary"` download URL, or creates temp asset for live recordings)
3. Sends MP4 audio to **Deepgram Nova-2** (`/v1/listen`) with `utterances=true`, `detect_language=true`, `smart_format=true`
4. Generates VTT subtitles from Deepgram response, saves VTT to Firestore (`captionVtt` field)
5. Uploads VTT to Mux as subtitle track via `serve-vtt` function (Mux fetches the VTT URL)
6. Sends transcript to **Claude Sonnet 4.6** for summary + quiz generation
7. Saves everything to Firestore `live-schedule` document

**Fields:** `aiStatus`, `aiError`, `aiSummary`, `aiSummaryLang`, `aiQuiz`, `aiTranscript`, `aiProcessedAt`, `captionVtt`, `captionLang`, `aiCaptionTrackId`

**Deepgram API config:** Model `nova-2`, features: `detect_language`, `smart_format`, `paragraphs`, `utterances` (with `utt_split=0.8`). API key stored in Netlify env. ~$1.20 per 4.5h recording.

### Retranscribe / Reprocess Commands

```bash
# Single session (full pipeline: Deepgram -> subtitles -> Claude summary)
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

**What retranscribe does:** Deletes old Mux subtitle tracks -> resets Firestore AI fields -> triggers `ai-process-recording-background` as a new invocation. Each session runs as a separate background function (15-min timeout).

**Troubleshooting stuck sessions:** If `aiStatus` is stuck at `transcribing`, the Deepgram call likely timed out (504). Just retrigger with the same curl. Check Deepgram dashboard (console.deepgram.com -> Usage -> Logs) to see if the request completed (200 OK) or failed. Dashboard times are UTC.

### Key Files

| File | Purpose |
|------|---------|
| `netlify/functions/ai-process-recording-background.js` | Main pipeline: MP4 -> Deepgram -> VTT -> Mux subtitles -> Claude summary |
| `netlify/functions/ai-backfill.js` | Admin tool: debug, retranscribe, MP4 status, subtitle management |
| `netlify/functions/serve-vtt.js` | Serves VTT from Firestore for Mux to ingest |
| `netlify/functions/mux-webhook.js` | Triggers pipeline when recording asset is ready |

---

## Store & Checkout — Detailed Reference

### Checkout Item Display Details

When `openCheckout()` renders the checkout item, it shows contextual details based on product type:

- **Teacher Training (Preparation Phase):** "Forberedelsesfasen" + period chip, format, description, benefits checklist (5 items), remaining payment info note
- **Course Bundles:** Month chip, individual course descriptions, discount savings, bonus pass highlight (for 3-course All-In)
- **Single Courses:** Month chip, course description
- **Memberships:** Feature checklist, first-month-free savings, terms list
- **Generic items:** Description text from `desc_da`/`desc_en`

The **remaining payment note** for teacher training reads:
- DA: *"Restbelobet afregnes inden uddannelsesstart -- enten som engangsbelob eller i rater. Din uddannelsesleder vil kontakte dig med alle detaljer og naeste skridt."*
- EN: *"The remaining balance is settled before training starts -- either in full or in instalments. Your course director will be in touch with all the details and next steps."*

### Checkout CSS Classes

| Class | Purpose |
|-------|---------|
| `.yb-store__checkout-meta` | Flex row for chips (period, phase label) |
| `.yb-store__checkout-meta-chip` | Orange pill badge |
| `.yb-store__checkout-meta-format` | Muted format text |
| `.yb-store__checkout-desc` | Gray description paragraph |
| `.yb-store__checkout-features` | Green-checkmark feature list |
| `.yb-store__checkout-remaining` | Gray info note with icon (remaining payment) |
| `.yb-store__checkout-bonus` | Orange bonus highlight |
| `.yb-store__checkout-saving` | Green savings badge |

### Checkout Flow Modal CSS Classes

| Class | Purpose |
|-------|---------|
| `.ycf-box` | Modal box override (max-width: 460px) |
| `.ycf-steps`, `.ycf-steps__dot`, `.ycf-steps__line` | Step indicator dots + connecting lines |
| `.ycf-step` | Step panel (fade-in animation) |
| `.ycf-product-badge` | Product preview card on login step |
| `.ycf-product` | Full product breakdown card on checkout step |
| `.ycf-chip`, `.ycf-chip--brand`, `.ycf-chip--muted` | Small pill badges |
| `.ycf-payment-methods`, `.ycf-payment-option` | Stored vs new card radio toggle |
| `.ycf-back` | Back navigation link with arrow icon |

### Checkout Flow Step-by-Step

1. **CTA button** anywhere on the site has `data-checkout-product="100121"` (or `onclick="startCheckoutFunnel('100121')"`)
2. `ytt-funnel.js` intercepts -> saves funnel data to sessionStorage -> calls `window.openCheckoutFlow(prodId)`
3. **checkout-flow.js** opens the modal:
   - If user is **already logged in** -> skip to Step 3 (checkout), resolve MB client + check stored card in background
   - If user is **not logged in** -> show Step 1 (login)

**Step 1 -- Login:** Login form + product preview badge (name, price, cohort, description). Links to "Create profile" (Step 2) and "Forgot password" (Step 1b).

**Step 2 -- Register:** First name, last name, email, phone, password + consent checkboxes. On submit: creates Firebase account -> **immediately creates Mindbody client** (triggers welcome email) -> advances to Step 3.

**Step 3 -- Checkout:** Product breakdown card (name, price, chips for phase/period/format, description, remaining payment note for YTT). If user has a stored card on file: radio toggle "Use saved card (Visa xxxx 4242)" vs "Enter new card". Card fields hidden when stored card selected. Payment via `mb-checkout` API.

**Step 4 -- Success:** Confirmation message -> "Go to your profile" button -> redirects to `/profile#passes` where the unsigned waiver card is waiting.

### Replicating Checkout for Hot Yoga CPH

1. Copy `modal-checkout-flow.njk` to the HYC templates directory
2. Copy `checkout-flow.js` to `hot-yoga-cph/public/js/checkout-flow.js`
3. Adapt the PRODUCTS object -- update prodIds, prices, names, periods to match HYC's catalog
4. Adapt the brand color -- replace `var(--yb-brand)` references with `#3f99a5`
5. Copy the `ycf-` CSS block from `main.css` to `hot-yoga-cph/public/css/profile.css`
6. Include the modal HTML + JS in HYC's base template
7. Wire up `ytt-funnel.js` equivalent on HYC CTA buttons
8. API endpoints are the same (`/.netlify/functions/mb-*`) -- ensure HYC site ID configured

---

## Bunny CDN — Folder Structure

All folders live under the root `yoga-bible-DK/` in Bunny Storage:

```
yoga-bible-DK/
|-- brand/            <- logos, favicons, brand assets
|-- homepage/         <- homepage hero, sections
|-- studio/           <- studio facility photos
|-- location/         <- venue/location photos
|-- courses/          <- course hero images
|   |-- inversions/
|   |-- backbends/
|   +-- splits/
|-- programs/
|   |-- p4w/          <- 4-week program
|   |-- p8w/          <- 8-week program
|   |-- p18w/         <- 18-week program
|   +-- om200/        <- 200-hour YTT overview
|-- accommodation/
|-- concepts/
|   |-- hotyoga/
|   |-- namaste/
|   +-- vibro/
|-- copenhagen/
|-- careers/
|-- apply/
|-- compare/
|-- mentorship/
|-- link/
|-- schedule/
|-- schedule-pages/
|   |-- 4w/
|   |-- 8w/
|   |-- 18w/
|   +-- 4w-jul/
|-- member/
|-- journal/
|-- materials/
|-- tutorials/
|   +-- homepage/
|-- yogamusic/
+-- yogaphotography/
    +-- models/
```

### Bunny CDN Path Convention

| Bunny Storage path | CDN URL |
|-------------------|---------|
| `yoga-bible-DK/brand/logo.png` | `https://yogabible.b-cdn.net/yoga-bible-DK/brand/logo.png` |
| `yoga-bible-DK/homepage/hero.jpg` | `https://yogabible.b-cdn.net/yoga-bible-DK/homepage/hero.jpg` |
| `yoga-bible-DK/courses/splits/reel.mp4` | `https://yogabible.b-cdn.net/yoga-bible-DK/courses/splits/reel.mp4` |

---

## Bunny Stream — Full Reference

### Account Details

| Setting | Value |
|---------|-------|
| Video Library ID | `627306` |
| API Key | Stored in `BUNNY_STREAM_API_KEY` env var |
| CDN Hostname | `vz-4f2e2677-3b6.b-cdn.net` |
| Pull Zone | `vz-4f2e2677-3b6` |
| Webhook URL | `https://yogabible.dk/.netlify/functions/bunny-stream-webhook` |
| Pricing | ~$0.005/min encoding, $0.005/GB storage, pay-as-you-go |

### Architecture

```
Admin Panel -> Upload (chunked TUS) -> Bunny Stream API
    | automatic transcoding (~1-2 min)
Bunny Stream -> 360p / 720p / 1080p / original
    | webhook fires
bunny-stream-webhook.js -> updates Firestore social_media collection
    |
Media Library shows video with auto-thumbnail
    | user edits (trim/crop/thumbnail)
Composer -> trim timestamps sent server-side -> optimized clip -> publish
```

### Upload Flow (TUS Protocol)

Video uploads use the official `tus-js-client` library (v4.2.3, loaded from `cdn.jsdelivr.net`). A previous custom XHR-based TUS implementation failed with 405 errors because Bunny's TUS endpoint requires precise protocol handling. Do NOT replace with custom XHR code.

1. Client calls `social-media-upload?action=create-video` -> returns `{ videoId, tusUploadUrl, authSignature, authExpiration, libraryId }`
2. Client creates `tus.Upload` instance with auth headers and uploads directly to Bunny Stream
3. Bunny auto-transcodes to multiple resolutions
4. Webhook fires -> `bunny-stream-webhook.js` updates Firestore
5. Client polls until status changes to `ready`

### Video URLs

```
Thumbnail: https://vz-4f2e2677-3b6.b-cdn.net/{videoId}/thumbnail.jpg
HLS:       https://vz-4f2e2677-3b6.b-cdn.net/{videoId}/playlist.m3u8
MP4:       https://vz-4f2e2677-3b6.b-cdn.net/{videoId}/play_720p.mp4
Preview:   https://vz-4f2e2677-3b6.b-cdn.net/{videoId}/preview.webp
```

### Firestore Collection

```
social_media/{videoId}:
  videoId, libraryId, title, status ("uploading"|"encoding"|"ready"|"failed"),
  uploadedBy, thumbnailUrl, hlsUrl, mp4Url, duration, width, height, fileSize,
  createdAt, encodedAt
```

---

## Social Media Platform Credentials — Full Reference

### TikTok Developer App

- **App Name:** Yoga Bible DK
- **Organization:** Yoga Bible
- **Organization ID:** `7621584075303699477`
- **Client Key:** `aw0ak2eupqflz21x`
- **Client Secret:** `dxz3xIbgqPEw980FWUaGDeuRh15LxTfb`
- **Platform:** Web
- **Required Scopes:** `video.publish`, `video.upload`, `user.info.basic`
- **Required Products:** Content Posting API, TikTok Account
- **Verified Domains:** `yogabible.dk`, `yogabible.com` (DNS TXT record method)
- **DNS TXT Record:** `tiktok-developers-site-verification=Ak7sI4jD9mUC9h2a44GZ6iY0s9dzpDiR`
- **Terms URL:** `https://yogabible.dk/terms-conditions/`
- **Privacy URL:** `https://yogabible.dk/privacy-policy/`
- **Status:** Pending review (submitted March 2026)
- **Note:** Domain verification covers all subdomains (www included).

### Meta (Instagram + Facebook) App

- **App Name:** Yoga Bible (same app for both IG and FB)
- **App ID:** `911693838016427`
- **App Secret:** `957ea128eb84074709c6ceba8a0103cd`
- **Facebook Page ID:** `878172732056415`
- **Facebook Page Name:** Yoga Bible
- **IG Business Account ID:** `17841474697451627`
- **Page Access Token (never expires):** stored in Firestore `social_accounts` collection
- **Permissions:** `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_messages`, `instagram_manage_insights`, `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, `pages_manage_metadata`, `ads_management`, `ads_read`, `business_management`, `leads_retrieval`, `whatsapp_business_messaging`, `whatsapp_business_management`
- **Token refresh:** Page tokens never expire. If permissions change, regenerate via Graph API Explorer -> exchange short->long-lived -> get page token via `/me/accounts`

### LinkedIn Developer App

- **App Name:** Yoga Bible
- **Client ID:** `78eu35dic8g09s`
- **Client Secret:** `WPL_AP1.kAu04Qag3m5MCtfV.18Uzsw==`
- **Organization ID:** `109163211`
- **Company Page:** `https://www.linkedin.com/company/109163211/`
- **Products:** Share on LinkedIn, Sign In with LinkedIn using OpenID Connect
- **Scopes:** `w_member_social`, `openid`, `profile` (org scopes pending page verification)
- **Token expires:** ~60 days
- **Redirect URI:** `https://yogabible.dk/admin/`

### YouTube (Google Cloud OAuth)

- **Google Cloud Project:** YogaBibleNetlifyProject (Project ID: `yogabiblenetlifyproject`)
- **Organization:** yogabible.dk
- **OAuth Client ID:** `969617587598-u23upn58qi3l3i1dgqm4en1th9kel602.apps.googleusercontent.com`
- **OAuth Client Secret:** `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`
- **Redirect URI:** `https://yogabible.dk/admin/`
- **Required Scopes:** `https://www.googleapis.com/auth/youtube.upload`, `https://www.googleapis.com/auth/youtube.readonly`
- **API Enabled:** YouTube Data API v3
- **Consent screen:** Internal (yogabible.dk org only, no verification needed)

### Pinterest Developer App

- **App Name:** Yoga Bible
- **App ID:** `1556643`
- **Platform:** Web
- **Required Scopes:** `pins:read`, `pins:write`, `boards:read`, `user_accounts:read`
- **Status:** Trial access pending
- **Domain Verification:** Meta tag added to `head.njk` (`p:domain_verify`)

---

## Design System — Full Approved Components Table

| # | Component | Usage Notes |
|---|-----------|-------------|
| 1 | **Colors** | Use only the approved palette. Hot Yoga CPH color only for Hot Yoga topics. |
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
| 12 | **Eyebrows** | Brand, With Line, With Dot. No others. |
| 13 | **Badges & Tags** | Primary, Secondary, Outline, Muted, Success, Warning, Pill, Badge Eyebrow. |
| 14 | **Forms** | Orange-stroke rounded inputs (12px radius, 1px solid brand orange). Two-column grid layout. |
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
| 30 | **Scroll-Draw Paths** | SVG vine/branch paths that draw on scroll. 5 variations. All SVGs must use `fill="none"` and `preserveAspectRatio="xMidYMid meet"`. |
| 31 | **Photography Page Layouts** | A: Dark Cinematic Photo Hero. B: Big Picture + Text Split (60/40). C-E: Art Grids. Use dark backgrounds. |
| 32 | **Model Showcase** | 3 variations. Each includes: name, bio, social links, portrait photo, featured yoga photos. A: Classic Three-Column. B: Hero Portrait Top. C: Side-by-Side Editorial. |

---

## Netlify Functions — Full Reference Table

| Function | Purpose |
|----------|---------|
| **Lead & CRM** | |
| `lead` | Lead capture endpoint (public) |
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
| **MindBody Integration** | |
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
| `knowledge-admin` | Agent knowledge base CRUD (admin) |
| `email-templates` | Email template preview/management (admin) |
| `bunny-browser` | Bunny Storage folder/asset browser (admin) |
| **Other** | |
| `catalog` | Public course catalog endpoint |
| `catalog-seed` | Seed catalog with initial data |
| `careers` | Careers form submission |
| `careers-seed` | Seed careers with initial data |
| `member-documents` | Member training documents |
| `seed-trainee-materials` | Seed trainee course materials |
| `schedule-token` | Schedule token validator |
| `schedule-visit` | Schedule page visit tracking |
| `site-visit` | Website behavior tracking |
| `backfill-schedule-tokens` | Generate schedule tokens for all existing leads |
| `auth-token` | Firebase auth token helper |
| `health` | Health check endpoint |
| `meta-capi` | Meta Conversions API (Facebook pixel server-side) |
| `mux-webhook` | Mux video webhook (live streaming) |
| `mux-stream` | Browser-based Mux live stream creation |
| `livekit-token` | LiveKit room creation + JWT token generation |
| `ai-process-recording-background` | Recording -> captions -> AI summary + quiz pipeline |
| `ai-backfill` | Utility for reprocessing past recordings |
| `instagram-webhook` | Instagram webhook handler |
| `instagram-send` | Send Instagram messages |
| `instagram-token-refresh` | Scheduled: refresh Instagram API token |

---

## Client-Side JS — Full Reference Table

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
| `profile.js` | User profile, store catalog, checkout, waiver, schedule, membership |
| `checkout-flow.js` | Multi-step checkout modal |
| `ytt-funnel.js` | YTT purchase funnel entry point |
| `mindbody.js` | MindBody API client-side helpers |
| **Page-Specific** | |
| `journal.js` | Blog listing -- language switch, search, progress bar, share |
| `glossary.js` | Yoga glossary page -- search, filter, letter nav |
| `schedule-embed.js` | MindBody schedule embed |
| `schedule-track.js` | Schedule page visit tracker |
| `site-track.js` | General site behavior tracker |
| `appointment-booking.js` | Appointment booking flow |
| `course.js` | Course page interactions |
| `course-viewer.js` | Course content viewer (enrolled students) |
| `member.js` | Member area |
| `member-courses.js` | Member course list |
| `member-materials.js` | Member training materials viewer |
| `live.js` | Live stream page |
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
| `knowledge-admin.js` | Agent knowledge base admin |

---

## Meta Ads CLI — Workflow Examples

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

**Notes:**
- All budgets are in **DKK** (the CLI handles the x100 conversion for the API)
- Created entities default to **PAUSED**
- `days` parameter: 1, 7, 14, 28, 30, or 90
- For create operations that need JSON files, the CLI prints example JSON when run without args
- Creatives can't be edited in-place -- `update-ad-text` creates a new creative and swaps it
