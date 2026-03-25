# API & Integration Versioning Audit

**Date:** 2026-03-11
**Status:** Initial audit

---

## Complete Integration Inventory

### 1. MindBody API

| Field | Value |
|-------|-------|
| **Base URL** | `https://api.mindbodyonline.com/public/v6` |
| **Version** | v6 (hardcoded in URL path) |
| **Package** | None — raw `fetch()` |
| **Auth** | API Key + Site ID headers |
| **Files** | `netlify/functions/shared/mb-api.js`, all `mb-*.js` functions |
| **Risk** | LOW — v6 is the latest and only REST version. No v7 announced. |
| **Deprecation** | v5.x (SOAP) was retired June 2024. v6 is current. |

**Action:** Monitor [MindBody API Release Notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes) quarterly.

---

### 2. Facebook/Meta Graph API

| Field | Value |
|-------|-------|
| **Base URL** | `https://graph.facebook.com/v21.0` |
| **Version** | v21.0 (hardcoded) |
| **Package** | None — raw `fetch()` |
| **Auth** | Page Access Token, App Secret (webhook HMAC) |
| **Files** | `netlify/functions/shared/instagram-api.js`, `facebook-leads-webhook.js`, `facebook-leads-backfill.js`, `meta-capi.js` |
| **Risk** | HIGH — Meta deprecates API versions on a ~2-year rolling schedule |
| **Deprecation** | v21.0 expected to deprecate ~Q4 2026. Latest is v25.0. |

**CRITICAL ACTION:**
- Upgrade from v21.0 → v25.0 (4 versions behind)
- Meta will stop accepting v21.0 requests once deprecated
- Webhooks mTLS certificate update required by **March 31, 2026** (20 days away!)

**Files to update:**
- `netlify/functions/shared/instagram-api.js` (lines 8-9)
- `netlify/functions/meta-capi.js` (line ~101)
- `netlify/functions/facebook-leads-webhook.js` (lines ~31, 254)
- `netlify/functions/facebook-leads-backfill.js`

---

### 3. Instagram Graph API

| Field | Value |
|-------|-------|
| **Base URL** | `https://graph.instagram.com/v21.0` |
| **Version** | v21.0 (shares version with Facebook Graph) |
| **Package** | None — raw `fetch()` |
| **Auth** | Instagram Access Token (auto-refreshed) |
| **Files** | `netlify/functions/shared/instagram-api.js`, `instagram-webhook.js`, `instagram-send.js`, `instagram-token-refresh.js` |
| **Risk** | HIGH — same deprecation schedule as Facebook Graph API |

**Action:** Upgrade together with Facebook Graph API to v25.0.

---

### 4. Firebase Admin SDK (Server)

| Field | Value |
|-------|-------|
| **Package** | `firebase-admin: ^13.6.1` |
| **Version** | Semver with caret (allows minor/patch) |
| **Auth** | Service account (FIREBASE_PRIVATE_KEY) |
| **Files** | `netlify/functions/shared/firestore.js`, most Netlify functions |
| **Risk** | LOW — Google maintains excellent backwards compatibility |

**Action:** Run `npm outdated` monthly. Major version bumps (e.g., v13 → v14) need manual review.

---

### 5. Firebase Client SDK (Browser)

| Field | Value |
|-------|-------|
| **CDN** | `https://www.gstatic.com/firebasejs/10.14.1/firebase-*-compat.js` |
| **Version** | `10.14.1` (exact, hardcoded in HTML) |
| **Files** | `src/_includes/base.njk`, `src/_includes/embed.njk`, `hot-yoga-cph/public/index.html` |
| **Risk** | MEDIUM — pinned exact version means no security patches auto-applied |
| **Note** | Using compat (v8-style) SDK, not modular v9+ |

**Action:** Check Firebase JS SDK releases quarterly. Update CDN version in 3 files. Consider migrating to modular SDK long-term.

---

### 6. Anthropic/Claude API

| Field | Value |
|-------|-------|
| **Base URL** | `https://api.anthropic.com/v1/messages` |
| **Version Header** | `anthropic-version: 2023-06-01` |
| **Model** | `claude-sonnet-4-6` |
| **Package (Python)** | `anthropic>=0.39.0` (lead-agent) |
| **Package (Server)** | None — raw `fetch()` in Netlify function |
| **Files** | `netlify/functions/ai-process-recording-background.js`, `lead-agent/` |
| **Risk** | LOW — `2023-06-01` is still the only/latest version header as of March 2026 |

**Action:** The Python SDK (`>=0.39.0`) has no upper bound — current is `0.84.0`. Consider pinning: `anthropic>=0.39.0,<1.0.0`.

---

### 7. GatewayAPI (SMS)

| Field | Value |
|-------|-------|
| **Endpoint** | `https://gatewayapi.eu/rest/mtsms` |
| **Version** | None in URL |
| **Package** | None — raw `fetch()` |
| **Auth** | Bearer token |
| **Files** | `netlify/functions/shared/sms-service.js` |
| **Risk** | MEDIUM — no versioning means breaking changes arrive unannounced |

**Action:** Monitor GatewayAPI changelog. No version negotiation available — test SMS sending weekly.

---

### 8. e-conomic API

| Field | Value |
|-------|-------|
| **Base URL** | `https://restapi.e-conomic.com` |
| **Version** | None in URL |
| **Package** | None — raw `fetch()` |
| **Auth** | X-AppSecretToken + X-AgreementGrantToken headers |
| **Files** | `netlify/functions/economic-admin.js` |
| **Risk** | MEDIUM — no URL versioning, Danish accounting API |

**Action:** Subscribe to e-conomic developer newsletter. Test invoice creation monthly.

---

### 9. Mux (Video/Streaming)

| Field | Value |
|-------|-------|
| **Base URL** | `https://api.mux.com` |
| **Version** | None in URL |
| **Package** | None — raw `fetch()` with Basic Auth |
| **Auth** | MUX_TOKEN_ID + MUX_TOKEN_SECRET |
| **Files** | `netlify/functions/mux-stream.js`, `mux-webhook.js`, `ai-process-recording-background.js` |
| **Risk** | MEDIUM — Mux occasionally changes response formats |

**Action:** Monitor [Mux changelog](https://docs.mux.com/changelog). Webhook payloads can change — validate shape.

---

### 10. LiveKit (Interactive Video)

| Field | Value |
|-------|-------|
| **Protocol** | Twirp (`/twirp/livekit.RoomService/`) |
| **Version** | None explicit |
| **Package** | None — custom JWT + HTTP |
| **Auth** | LIVEKIT_API_KEY + LIVEKIT_API_SECRET (HS256 JWT) |
| **Files** | `netlify/functions/livekit-token.js` |
| **Risk** | MEDIUM — Twirp protocol is stable but LiveKit evolves quickly |

**Action:** Monitor LiveKit releases. The custom JWT implementation bypasses SDK updates.

---

### 11. Bunny CDN (replaced Cloudinary March 2026)

| Field | Value |
|-------|-------|
| **CDN** | `https://yogabible.b-cdn.net` |
| **Storage API** | `https://storage.bunnycdn.com/yogabible/` |
| **Storage Zone** | `yogabible` |
| **Files** | `.eleventy.js`, `netlify/functions/bunny-browser.js` |
| **Risk** | LOW — simple REST API, no SDK dependency |

**Action:** None. Bunny Optimizer handles image transforms at delivery time.

---

### 12. Resend (Email)

| Field | Value |
|-------|-------|
| **Base URL** | `https://api.resend.com` |
| **Version** | None in URL |
| **Package** | None — raw `fetch()` |
| **Auth** | Bearer token (RESEND_API_KEY) |
| **Files** | `netlify/functions/shared/resend-service.js`, `send-password-reset.js` |
| **Risk** | LOW-MEDIUM — Resend is a newer service, API is simple |

**Action:** Monitor Resend changelog quarterly.

---

### 13. Nodemailer (Gmail SMTP)

| Field | Value |
|-------|-------|
| **Package** | `nodemailer: ^8.0.1` |
| **Protocol** | SMTP (not a versioned API) |
| **Auth** | Gmail App Password |
| **Risk** | LOW — SMTP is a stable protocol |

**Action:** Google occasionally changes App Password policies. Monitor Google Workspace announcements.

---

### 14. Google APIs (SEO Agent)

| Field | Value |
|-------|-------|
| **PageSpeed** | `googleapis.com/pagespeedonline/v5/runPagespeed` |
| **Search Console** | Via `googleapiclient.discovery` (auto-discovers latest) |
| **Packages** | `google-api-python-client>=2.100.0`, `google-auth>=2.23.0` |
| **Files** | `seo-agent/checks.py` |
| **Risk** | LOW — Google's discovery-based client auto-negotiates versions |

**Action:** Pin upper bounds: `google-api-python-client>=2.100.0,<3.0.0`.

---

### 15. Telegram Bot API (Lead Agent)

| Field | Value |
|-------|-------|
| **Package** | `python-telegram-bot>=21.0` |
| **Version** | Telegram Bot API (auto-versioned by library) |
| **Files** | `lead-agent/agent.py`, `lead-agent/tools/telegram.py` |
| **Risk** | LOW-MEDIUM — Telegram Bot API is additive, rarely breaks |

**Action:** Pin: `python-telegram-bot>=21.0,<22.0`.

---

## Risk Summary

| Risk | Integration | Issue |
|------|------------|-------|
| **CRITICAL** | Facebook/Instagram Graph API | v21.0 is 4 versions behind (v25.0 is latest). mTLS cert update due March 31, 2026. |
| **HIGH** | Python dependencies (lead-agent, seo-agent) | All use `>=` with no upper bounds — any major version bump auto-installs and could break. |
| **MEDIUM** | Firebase Client SDK | Pinned at 10.14.1 — no auto security patches. |
| **MEDIUM** | GatewayAPI, e-conomic, Mux, LiveKit | No URL versioning — breaking changes arrive without warning. |
| **LOW** | MindBody, Cloudinary, Anthropic, Nodemailer, Google APIs | Stable versions, good backwards compatibility. |

---

## Recommended Solution: API Health Monitor

### Option A: Extend the Existing SEO Agent (Recommended)

Your `seo-agent/` already runs scheduled checks with APScheduler and sends Telegram alerts. Add an **API Health Check module** that:

1. **Pings each integration endpoint** weekly (lightweight health check)
2. **Checks version freshness** against known latest versions
3. **Monitors deprecation dates** and alerts 90/60/30 days before
4. **Validates response schemas** to detect silent breaking changes
5. **Reports via Telegram** (same channel as SEO alerts)

**Why this is best:**
- Reuses existing infrastructure (APScheduler, Telegram, Python)
- No new service to maintain
- Runs on the same Mac Mini as the lead agent
- You already check Telegram daily

### Checks to implement:

```
Weekly:
- Facebook Graph API: GET /me?access_token=... → check if v21.0 still responds
- MindBody: GET /site/sites → verify v6 responds
- GatewayAPI: Send test SMS to sandbox
- Mux: GET /video/v1/assets (list) → verify auth works
- LiveKit: Create + delete test room
- Cloudinary: GET /resources/image → verify auth
- e-conomic: GET /self → verify tokens
- Resend: GET /domains → verify key
- Firebase: Read a test document

Daily:
- Check npm outdated (parse JSON output)
- Check pip outdated for lead-agent + seo-agent
- Compare hardcoded API versions against known latest
```

### Option B: Standalone API Watchdog Agent

A dedicated Python agent that:
- Scrapes changelog/release pages for each API
- Compares against your pinned versions
- Sends Telegram diff alerts when new versions drop
- Tracks deprecation timelines

**Downside:** Another service to maintain.

### Option C: GitHub Dependabot + Manual Checks

- Enable Dependabot for npm + pip
- Set up GitHub Actions to run weekly version checks
- Manual quarterly review

**Downside:** Doesn't catch unversioned API changes (GatewayAPI, e-conomic, Mux).

---

## Immediate Actions Required

### 1. URGENT: Facebook/Instagram Graph API Upgrade (v21.0 → v25.0)
- Update version string in 4 files
- Test all Lead Ads webhook flows
- Test Instagram DM flows
- Test Meta CAPI events
- **Deadline:** Before v21.0 deprecation (~Q4 2026, but don't wait)

### 2. URGENT: Meta Webhooks mTLS Certificate (Due March 31, 2026)
- Update webhook trust store to accept Meta's new Certificate Authority
- If running on Netlify Functions, this may be handled automatically
- **Verify immediately**

### 3. Pin Python dependency upper bounds

```txt
# lead-agent/requirements.txt
anthropic>=0.39.0,<1.0.0
google-cloud-firestore>=2.19.0,<3.0.0
apscheduler>=3.10.4,<4.0.0
python-dotenv>=1.0.1,<2.0.0
aiohttp>=3.10.0,<4.0.0
python-telegram-bot>=21.0,<22.0

# seo-agent/requirements.txt
python-dotenv>=1.0.1,<2.0.0
apscheduler>=3.10.4,<4.0.0
google-api-python-client>=2.100.0,<3.0.0
google-auth>=2.23.0,<3.0.0
```

### 4. Update Firebase Client SDK
- Current: 10.14.1
- Check latest and update in `base.njk`, `embed.njk`, `hot-yoga-cph/public/index.html`

### 5. Centralize API version constants
- Create `netlify/functions/shared/api-versions.js` with all version strings
- Single place to update when upgrading

---

## Monitoring Calendar

| Frequency | Check |
|-----------|-------|
| **Weekly** | API health pings (automated via agent) |
| **Monthly** | `npm outdated`, `pip list --outdated` |
| **Quarterly** | Review Meta Graph API version, MindBody release notes, Firebase SDK |
| **Per release** | Dependabot PRs for npm/pip |
