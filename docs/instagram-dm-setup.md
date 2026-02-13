# Instagram DM Automation — Setup Guide

## Overview

This system automates Instagram DM responses for @yoga_bible using Netlify Functions and the Meta Instagram Graph API. When someone DMs a keyword, comments a keyword on a post, mentions @yoga_bible in a story, or follows the account, they receive an automatic response.

## Architecture

```
Instagram → Meta Webhook → Netlify Function → Instagram Graph API → DM Sent
                              ↓
                         Firestore (analytics)
```

### Files

| File | Purpose |
|------|---------|
| `netlify/functions/instagram-webhook.js` | Main webhook handler (verification + event routing) |
| `netlify/functions/instagram-send.js` | Admin utility for manual DM sending |
| `netlify/functions/shared/instagram-api.js` | Shared helper (API calls, rate limiting, Firestore logging) |
| `src/_data/dm-keywords.json` | Keyword → response mapping (bilingual DA/EN) |
| `src/_data/dm-templates.json` | Message templates (welcome, fallback, story mentions) |

---

## Step 1: Create a Meta App

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Click **Create App** → Choose **Business** type
3. Name it (e.g., "Yoga Bible DM Bot")
4. Select your Business portfolio

## Step 2: Add Instagram Messaging Product

1. In your app dashboard, click **Add Product**
2. Find **Instagram** → Click **Set Up**
3. Under Instagram settings, connect your Instagram Professional Account (@yoga_bible)
4. The Instagram account must be a **Business** or **Creator** account connected to a Facebook Page

## Step 3: Configure Permissions

Request these permissions in your app:

| Permission | Purpose |
|------------|---------|
| `instagram_manage_messages` | Send and receive DMs |
| `instagram_basic` | Read account info |
| `pages_messaging` | Required for messaging via connected Page |
| `instagram_manage_comments` | Read comments for keyword triggers |
| `pages_manage_metadata` | Required for webhook subscriptions |

For development/testing, these can be granted immediately. For production, submit for App Review.

## Step 4: Generate Access Token

1. In Meta App Dashboard → **Instagram** → **API Setup**
2. Generate a **long-lived access token** (60-day validity)
3. For production, set up automatic token refresh:
   - Exchange the short-lived token for a long-lived one
   - Store in Netlify env vars
   - Refresh every 50 days (before 60-day expiry)

### Token Refresh (manual)

```bash
# Exchange short-lived for long-lived token
curl -G "https://graph.instagram.com/access_token" \
  -d "grant_type=ig_exchange_token" \
  -d "client_secret=YOUR_APP_SECRET" \
  -d "access_token=YOUR_SHORT_LIVED_TOKEN"

# Refresh a long-lived token (before it expires)
curl -G "https://graph.instagram.com/refresh_access_token" \
  -d "grant_type=ig_refresh_token" \
  -d "access_token=YOUR_LONG_LIVED_TOKEN"
```

## Step 5: Set Environment Variables in Netlify

Go to **Netlify Dashboard** → Site → **Environment Variables** and add:

| Variable | Value | Description |
|----------|-------|-------------|
| `META_APP_SECRET` | Your app secret | From Meta App Dashboard → Settings → Basic |
| `META_ACCESS_TOKEN` | Long-lived token | Generated in Step 4 |
| `META_VERIFY_TOKEN` | A random string you choose | Used for webhook verification (e.g., `yogabible_ig_2024`) |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Your IG account ID | From Meta App Dashboard → Instagram → API Setup |
| `INSTAGRAM_ADMIN_KEY` | A random string you choose | Protects the manual send endpoint |

### Optional (for Firestore logging):

| Variable | Value | Description |
|----------|-------|-------------|
| `FIREBASE_SERVICE_ACCOUNT_KEY` | JSON string | Service account key for Firestore writes (entire JSON, not a file path) |

To get the Firebase service account key:
1. Go to [Firebase Console](https://console.firebase.google.com/) → yoga-bible-dk-com → Project Settings → Service Accounts
2. Click **Generate new private key**
3. Copy the entire JSON content as the env var value

## Step 6: Configure Webhook in Meta App

1. In Meta App Dashboard → **Instagram** → **Webhooks**
2. Click **Configure** (or **Edit Subscription**)
3. Set the callback URL:
   ```
   https://yogabible.dk/.netlify/functions/instagram-webhook
   ```
4. Set the **Verify Token** to the same value as your `META_VERIFY_TOKEN` env var
5. Click **Verify and Save**
6. Subscribe to these webhook fields:
   - `messages` — DM messages
   - `messaging_postbacks` — Button clicks
   - `comments` — Post comments (for keyword triggers)
   - `story_insights` — Story mentions
   - `messaging_referrals` — Story replies / ad referrals

## Step 7: Test the Integration

### 1. Verify webhook is reachable

```bash
curl "https://yogabible.dk/.netlify/functions/instagram-webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=test123"
# Should return: test123
```

### 2. Send a test DM

DM the word "HEJ" to @yoga_bible on Instagram. You should receive the welcome message with keyword menu.

### 3. Test admin send endpoint

```bash
curl -X POST "https://yogabible.dk/.netlify/functions/instagram-send" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: YOUR_ADMIN_KEY" \
  -d '{
    "recipientId": "INSTAGRAM_SCOPED_USER_ID",
    "keyword": "HEJ",
    "language": "da"
  }'
```

### 4. Check Netlify Function logs

In **Netlify Dashboard** → **Functions** → `instagram-webhook` → View logs

All interactions are logged with `[ig-webhook]` and `[ig-api]` prefixes.

---

## Keyword Reference

| Keyword | Aliases | Response |
|---------|---------|----------|
| HEJ | HI, HELLO, HEY, NAMASTE | Welcome menu with all keywords |
| 200HR | UDDANNELSE, TRAINING, YTT | Training overview + link |
| 4UGER | 4WEEKS, INTENSIVE | 4-week program details |
| 8UGER | 8WEEKS, SEMI-INTENSIVE | 8-week program details |
| 18UGER | 18WEEKS, FLEXIBLE | 18-week program details |
| 300HR | ADVANCED, AVANCERET | Advanced training info |
| KURSER | COURSES, WORKSHOPS | Course overview |
| INVERSIONS | HANDSTAND, HEADSTAND | Inversions course |
| BACKBENDS | BAGOVERBØJNING | Backbends course |
| SPLITS | SPAGAT, FLEXIBILITY | Splits course |
| MENTORSHIP | PRIVAT, PRIVATE | Private training info |
| SCHEDULE | SKEMA, KLASSER, CLASSES | Class schedule link |
| MUSIC | MUSIK, PLAYLIST | SoundCloud playlists |
| APPLY | ANSØG, TILMELD, ENROLL | Application form link |
| PRIS | PRICE, PRICING | Pricing comparison |

To add or modify keywords, edit `src/_data/dm-keywords.json`.

---

## Rate Limiting

The system includes built-in rate limiting:
- **180 requests per hour** (Instagram API limit is 200/hr)
- In-memory sliding window per Netlify container
- When rate limited, messages are skipped with a warning log

## Firestore Analytics

When `FIREBASE_SERVICE_ACCOUNT_KEY` is configured, all interactions are logged to the `instagram_interactions` collection with:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "type": "keyword_dm | fallback_dm | comment_trigger | story_mention | new_follower | admin_send",
  "senderId": "instagram_scoped_user_id",
  "keyword": "200HR",
  "language": "da",
  "response": "matched | fallback | welcome",
  "source": "dm | comment | story_mention | story_reply | follow | admin_api"
}
```

## Troubleshooting

### Webhook verification fails
- Check that `META_VERIFY_TOKEN` in Netlify matches what you entered in Meta App
- Verify the webhook URL is exactly `https://yogabible.dk/.netlify/functions/instagram-webhook`

### Messages not sending
- Check Netlify Function logs for `[ig-api]` errors
- Verify `META_ACCESS_TOKEN` is valid and not expired
- Ensure `INSTAGRAM_BUSINESS_ACCOUNT_ID` is correct
- Check that the Instagram account has a linked Facebook Page

### 403 or permission errors
- Ensure all required permissions are granted in Meta App
- For production, permissions must pass App Review

### Rate limit errors
- The system automatically throttles at 180 req/hr
- If you see rate limit warnings, reduce automated trigger volume

### Token expiry
- Long-lived tokens expire after 60 days
- Set a calendar reminder to refresh every 50 days
- Or implement automatic refresh via a scheduled Netlify Function
