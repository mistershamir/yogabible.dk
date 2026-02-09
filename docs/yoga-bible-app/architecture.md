# Yoga Bible App — Technical Architecture

> React Native + Mux + Firebase + MindBody
> Created: 2026-02-09

---

## 1. Product Overview

The Yoga Bible App is a mobile and TV application for yoga practitioners, offering on-demand video classes, live class booking, course learning, and membership management. It connects to the same backend infrastructure as yogabible.dk and shares a user base with Namaste Online.

### Platform Targets

| Platform | Framework | Priority |
|----------|-----------|----------|
| iOS (iPhone/iPad) | React Native | Phase 1 |
| Android (Phone/Tablet) | React Native | Phase 1 |
| Apple TV | React Native tvOS | Phase 2 |
| Android TV / Fire TV | React Native | Phase 2 |

---

## 2. Ecosystem Map

```
┌─────────────────────────────────────────────────────┐
│                    USER ACCOUNT                      │
│              (Single Firebase Identity)               │
└──────────┬──────────────┬──────────────┬────────────┘
           │              │              │
    ┌──────▼──────┐ ┌────▼─────┐ ┌─────▼──────┐
    │ yogabible.dk│ │Yoga Bible│ │  Namaste   │
    │  (Website)  │ │   App    │ │  Online    │
    │  Eleventy   │ │  React   │ │  Flutter   │
    │  Netlify    │ │  Native  │ │  (Dev Team)│
    └──────┬──────┘ └────┬─────┘ └─────┬──────┘
           │              │              │
    ┌──────▼──────────────▼──────────────▼────────────┐
    │              SHARED BACKEND                       │
    │                                                   │
    │  ┌─────────────┐  ┌──────────┐  ┌────────────┐  │
    │  │   Firebase   │  │   Mux    │  │  MindBody  │  │
    │  │  Auth +      │  │  Video   │  │  Booking   │  │
    │  │  Firestore   │  │  Hosting │  │  Payments  │  │
    │  └─────────────┘  └──────────┘  └────────────┘  │
    │                                                   │
    │  ┌─────────────────────────────────────────────┐ │
    │  │  Netlify Functions (API Layer)               │ │
    │  │  mb-classes, mb-book, mb-checkout, etc.      │ │
    │  └─────────────────────────────────────────────┘ │
    └──────────────────────────────────────────────────┘
```

---

## 3. Screen Map — App Features

Every screen below maps to existing website functionality or is a new addition.

### Tab Bar Navigation (Bottom)

```
┌──────┬──────────┬─────────┬─────────┬─────────┐
│ Home │ Schedule │ Library │ Courses │ Profile │
└──────┴──────────┴─────────┴─────────┴─────────┘
```

### Screen-by-Screen Breakdown

#### 3.1 Home (Dashboard)

| Element | Data Source | Exists on Website? |
|---------|------------|-------------------|
| Welcome message + name | Firestore user profile | Yes (profile.js) |
| Today's booked classes | MindBody mb-classes | Yes (mindbody.js) |
| Continue watching (video) | Firestore watch history | New |
| Continue course (progress) | Firestore enrollments | Yes (course-viewer.js) |
| Featured new videos | Mux asset metadata | New |
| Daily inspiration quote | Firestore or static | New (simple) |

#### 3.2 Schedule & Booking

| Element | Data Source | Exists on Website? |
|---------|------------|-------------------|
| Weekly calendar (Mon-Sun) | MindBody mb-classes | Yes (mindbody.js) |
| Class cards (time, teacher, spots) | MindBody mb-classes | Yes |
| Book / Cancel buttons | MindBody mb-book | Yes |
| Waitlist management | MindBody mb-waitlist | Yes |
| Class descriptions | MindBody mb-class-descriptions | Yes |
| Instructor bios + photos | MindBody mb-staff | Yes |
| Location info | MindBody mb-site | Yes |
| Active passes display | MindBody mb-client-services | Yes |

**API endpoints (already built):**
- `/.netlify/functions/mb-classes`
- `/.netlify/functions/mb-book`
- `/.netlify/functions/mb-waitlist`
- `/.netlify/functions/mb-class-descriptions`
- `/.netlify/functions/mb-staff`
- `/.netlify/functions/mb-site`
- `/.netlify/functions/mb-client-services`

#### 3.3 Video Library (NEW — Mux)

| Element | Data Source | New? |
|---------|------------|------|
| Category grid (Vinyasa, Yin, etc.) | Firestore collection | New |
| Video cards (thumbnail, duration, teacher) | Mux asset API | New |
| Search + filter (style, duration, level) | Firestore queries | New |
| Video player (HLS adaptive streaming) | Mux Playback | New |
| Download for offline | Mux signed URLs | New |
| Watch history + resume position | Firestore | New |
| Favorites / saved videos | Firestore | New |
| Teacher profiles | Firestore + MindBody | Partial |

**Mux Architecture:**
```
Upload flow:
  Admin uploads video → Mux Upload API → Mux processes (HLS + thumbnails)
                                        → Asset ID stored in Firestore

Playback flow:
  App requests video → Gets Mux Playback ID from Firestore
                     → Mux Player SDK streams HLS
                     → DRM (Widevine/FairPlay) for paid content
                     → Analytics via Mux Data SDK

Offline flow:
  User taps download → App requests signed URL from backend
                     → Downloads HLS segments to device storage
                     → Plays locally (with DRM token expiry)
```

**Mux SDKs needed:**
- `@mux/mux-player-react-native` — Video player component
- `@mux/mux-data-react-native` — Quality analytics
- Mux REST API (server-side) — Asset management, upload URLs, signed playback

#### 3.4 Course Viewer (LMS)

| Element | Data Source | Exists on Website? |
|---------|------------|-------------------|
| Enrolled courses list | Firestore enrollments | Yes (course-viewer.js) |
| Module → Chapter navigation | Firestore course structure | Yes |
| Chapter content (text/HTML) | Firestore chapters | Yes |
| Video chapters | Mux Playback | New (currently text only) |
| Progress tracking | Firestore progress | Yes |
| Chapter notes | Firestore notes | Yes |
| Chapter comments | Firestore comments | Yes |
| Completion certificates | New | New |

**Firestore collections (already exist):**
- `courses/{courseId}`
- `courses/{courseId}/modules/{moduleId}`
- `courses/{courseId}/modules/{moduleId}/chapters/{chapterId}`
- `enrollments/{odcumentId}` (userId + courseId)

#### 3.5 Profile & Account

| Element | Data Source | Exists on Website? |
|---------|------------|-------------------|
| Personal info (name, email, phone, DOB) | Firestore profile | Yes (profile.js) |
| Profile photo | Firestore photoUrl | Yes |
| Membership tier + status | Firestore + MindBody | Yes |
| Active passes | MindBody mb-client-services | Yes |
| Visit history | MindBody mb-visits | Yes |
| Purchase receipts | MindBody mb-purchases | Yes |
| Enrolled courses | Firestore enrollments | Yes |
| Pause / Cancel membership | MindBody mb-contract-manage | Yes |
| Waiver status | Firestore waivers | Yes |
| Language preference (DA/EN) | Firestore locale | Yes |
| Push notification settings | Firestore + FCM | New |
| Download management | Local storage | New |

#### 3.6 Authentication

| Element | Data Source | Exists on Website? |
|---------|------------|-------------------|
| Email/password login | Firebase Auth | Yes (firebase-auth.js) |
| Registration + consent | Firebase Auth + Firestore | Yes |
| Password reset | Firebase Auth | Yes |
| MindBody client linking | Netlify Function mb-sync | Yes |
| Biometric login (Face ID / fingerprint) | Firebase Auth + device | New |

#### 3.7 Checkout & Store

| Element | Data Source | Exists on Website? |
|---------|------------|-------------------|
| Available packages | MindBody mb-contracts | Yes |
| Package details + pricing | MindBody mb-contracts | Yes |
| Card payment | MindBody mb-checkout | Yes |
| Apple Pay / Google Pay | Stripe SDK or IAP | New |
| Promo codes | MindBody mb-checkout | Yes |

**Important note on payments:**
Apple and Google take 30% on in-app purchases. For physical services (yoga classes), you CAN use external payment processing (Stripe/MindBody) without going through App Store IAP. This is allowed under their "reader" rules for physical goods/services. Digital-only content (video library subscription) may require IAP — check current App Store guidelines.

---

## 4. TV App (Phase 2) — Simplified Interface

TV apps focus on video consumption with remote/D-pad navigation.

### TV Screen Map

```
┌───────────────────────────────────────────────┐
│  YOGA BIBLE                    [Profile] [Search] │
├───────────────────────────────────────────────┤
│                                               │
│  ▶ Continue Watching                          │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐            │
│  │     │ │     │ │     │ │     │   ◄ ►       │
│  └─────┘ └─────┘ └─────┘ └─────┘            │
│                                               │
│  ▶ Vinyasa Flow                               │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐            │
│  │     │ │     │ │     │ │     │   ◄ ►       │
│  └─────┘ └─────┘ └─────┘ └─────┘            │
│                                               │
│  ▶ Yin Yoga                                   │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐            │
│  │     │ │     │ │     │ │     │   ◄ ►       │
│  └─────┘ └─────┘ └─────┘ └─────┘            │
└───────────────────────────────────────────────┘
```

**TV features (video-focused only):**
- Browse video library by category
- Video player with playback controls
- Continue watching / watch history
- User profile (switch accounts)
- Search (voice search via remote)
- No booking, no checkout, no course text content

---

## 5. Tech Stack

### React Native App

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | React Native 0.76+ | Cross-platform mobile |
| Language | TypeScript | Type safety |
| Navigation | React Navigation v7 | Screen routing + tab bar |
| State | Zustand or Redux Toolkit | Global state management |
| Auth | @react-native-firebase/auth | Firebase Authentication |
| Database | @react-native-firebase/firestore | Firestore access |
| Video | @mux/mux-player-react-native | Mux video playback |
| Analytics | @mux/mux-data-react-native | Video quality metrics |
| Push | @react-native-firebase/messaging | FCM notifications |
| Payments | MindBody API (via Netlify Functions) | Class packs + memberships |
| Offline | @react-native-community/netinfo + MMKV | Offline detection + local storage |
| i18n | react-i18next | Danish + English |
| TV | react-native-tvos | Apple TV / Android TV |

### Backend (Shared — Already Built)

| Service | Purpose | Status |
|---------|---------|--------|
| Firebase Auth | User authentication | Exists |
| Firestore | User profiles, courses, waivers, video metadata | Exists (extend for videos) |
| Netlify Functions | MindBody API proxy (18 endpoints) | Exists |
| Mux | Video hosting, streaming, DRM | New (shared with Namaste) |

### New Backend Additions Needed

| Function | Purpose |
|----------|---------|
| `mux-upload-url.js` | Generate signed upload URL for admin |
| `mux-playback-token.js` | Generate signed playback token (DRM) |
| `mux-webhook.js` | Receive Mux asset.ready events → update Firestore |
| `push-notify.js` | Send class reminder push notifications |

---

## 6. Data Model Extensions

### New Firestore Collections (for video library)

```
videos/{videoId}
├── title_da: "30 min Vinyasa Flow"
├── title_en: "30 min Vinyasa Flow"
├── description_da: "..."
├── description_en: "..."
├── muxAssetId: "abc123"
├── muxPlaybackId: "xyz789"
├── thumbnailUrl: "https://image.mux.com/xyz789/thumbnail.jpg"
├── duration: 1800  (seconds)
├── category: "vinyasa"
├── level: "beginner|intermediate|advanced|all"
├── teacher: "Teacher Name"
├── teacherId: "firebase_uid_or_mb_staff_id"
├── tags: ["morning", "energizing", "30min"]
├── gated: true  (requires membership)
├── publishedAt: timestamp
├── createdAt: timestamp
└── status: "ready|processing|error"

users/{uid}/watchHistory/{videoId}
├── videoId: "ref"
├── lastPosition: 847  (seconds)
├── completed: false
├── watchedAt: timestamp
└── totalWatched: 1200  (seconds)

users/{uid}/favorites/{videoId}
├── videoId: "ref"
└── addedAt: timestamp

users/{uid}/downloads/{videoId}
├── videoId: "ref"
├── downloadedAt: timestamp
├── expiresAt: timestamp  (DRM token expiry)
└── localPath: "file://..."
```

---

## 7. API Architecture

```
React Native App
       │
       ├── Firebase SDK (direct)
       │   ├── Auth (login, register, reset)
       │   ├── Firestore (profiles, courses, videos, history)
       │   └── Cloud Messaging (push tokens)
       │
       ├── Mux Player SDK (direct)
       │   └── HLS video streaming (uses playback ID)
       │
       └── Netlify Functions (HTTPS)
           ├── /mb-classes      → MindBody class schedule
           ├── /mb-book         → Book a class
           ├── /mb-checkout     → Process payment
           ├── /mb-client       → Client lookup/create
           ├── /mb-contracts    → Available memberships
           ├── /mb-client-services → Active passes
           ├── /mb-purchases    → Receipt history
           ├── /mb-visits       → Attendance history
           ├── /mb-waitlist     → Waitlist management
           ├── /mb-contract-manage → Pause/cancel
           ├── /mb-sync         → Firebase ↔ MindBody sync
           ├── /mb-staff        → Instructor directory
           ├── /mux-playback-token → Signed playback (NEW)
           ├── /mux-upload-url    → Admin upload URL (NEW)
           └── /push-notify       → Send notifications (NEW)
```

---

## 8. Phased Roadmap

### Phase 1 — Core Mobile App (MVP)

**Goal:** Working iOS + Android app with auth, booking, and video library.

1. Project setup (React Native + TypeScript + Firebase)
2. Authentication screens (login, register, reset, biometric)
3. Profile screen (all existing tabs)
4. Schedule + booking screens (MindBody integration)
5. Mux video player integration
6. Video library screen (browse, search, filter)
7. Watch history + favorites
8. Push notifications (class reminders)
9. Bilingual support (DA/EN)
10. App Store + Play Store submission

### Phase 2 — Content & Learning

1. Course viewer (text + video chapters)
2. Offline video downloads
3. Glossary screen
4. Journal/blog reader
5. Deep links (web ↔ app)

### Phase 3 — TV Apps

1. Apple TV interface (tvOS)
2. Android TV / Fire TV interface
3. Video-focused navigation
4. Voice search
5. Continue watching across devices

### Phase 4 — Advanced

1. Live streaming (connect with Namaste Online / Mux Live)
2. Social features (class check-ins, streaks)
3. Apple Pay / Google Pay
4. Widgets (iOS home screen, Android)
5. Apple Watch companion (class timer)

---

## 9. Design System for App

Translate the website's design system to React Native:

```javascript
// theme.ts — Yoga Bible Design Tokens

export const colors = {
  brand:      '#f75c03',  // Primary orange
  brandDark:  '#d94f02',  // Hover/pressed states
  brandLight: '#ff9966',  // Accents
  black:      '#0F0F0F',  // Text, dark backgrounds
  muted:      '#6F6A66',  // Secondary text
  border:     '#E8E4E0',  // Dividers
  lightBg:    '#F5F3F0',  // Section backgrounds
  warmWhite:  '#FFFCF9',  // Cards
  white:      '#FFFFFF',
  hotYogaCph: '#3f99a5',  // Hot Yoga CPH only
};

export const typography = {
  fontFamily: 'AbacaxiLatin',  // Bundle with app
  sizes: {
    hero:    32,
    section: 24,
    card:    18,
    body:    16,
    caption: 14,
    eyebrow: 12,
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,  // Pill shape
};
```

---

## 10. Mux Account Setup

### What You Need

1. **Mux account** at mux.com (one account for both Namaste + Bible)
2. **API Access Token** (Token ID + Token Secret)
3. **Environment:** Production (live) or Development (testing)

### Mux Configuration

```
Mux Dashboard
├── Environments
│   ├── Development (free testing, watermarked)
│   └── Production (paid, no watermark)
├── Video
│   ├── Assets (uploaded videos)
│   ├── Live Streams (for Namaste integration later)
│   └── Uploads (direct upload URLs)
├── Data (analytics)
│   └── Video quality metrics
└── Settings
    ├── Signing Keys (for DRM/signed playback)
    └── Webhooks (asset.ready → your Netlify function)
```

### Pricing Estimate (Mux)

| Item | Cost | Notes |
|------|------|-------|
| Video encoding | $0.015/min | One-time per video |
| Video storage | $0.007/GB/month | ~1GB per hour of video |
| Video delivery | $0.00096/min viewed | Per viewer minute |
| Live streaming | $0.025/min | Per stream minute |

Example: 100 videos (avg 30 min each) = 50 hours of content
- Encoding: ~$45 one-time
- Storage: ~$3.50/month
- If 500 users watch 2 hours/month: ~$57.60/month

---

## 11. Security Considerations

| Area | Approach |
|------|----------|
| Auth tokens | Firebase Auth SDK handles refresh automatically |
| API calls | Netlify Functions validate Firebase ID token |
| Video DRM | Mux signed playback URLs (time-limited) |
| Offline DRM | Token expiry forces re-auth (7-day window) |
| Payments | PCI handled by MindBody/Stripe |
| User data | Firestore security rules (per-user isolation) |
| API keys | Stored in Netlify env vars, never in app bundle |
| Certificate pinning | Optional, recommended for payment flows |
