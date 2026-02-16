# Media Inventory — yogabible.dk

> Complete checklist of every image, video, and media reference across the site.
> All assets are served via **Cloudinary CDN** (cloud name: `ddcynsa30`).
>
> **Status legend:** EXISTS = already in repo | EXTERNAL CDN = on yogabible.dk/s/ | MISSING = referenced but no file | PLACEHOLDER = HTML div placeholder | DEFAULT OG = using generic fallback image | UNSPLASH/PRAVATAR = third-party placeholder

---

## How to Add Media

### 1. Upload to Cloudinary

Go to your [Cloudinary Media Library](https://console.cloudinary.com/console/media_library) and upload files into the folder structure below. The **Cloudinary Upload Path** column in each table tells you exactly where to put each file.

### 2. Folder Structure in Cloudinary

Create these folders in your Cloudinary Media Library:

```
yoga-bible-DK/
├── brand/
├── homepage/
├── studio/
├── location/
├── courses/
│   └── inversions/
├── programs/
│   └── p4w/
├── accommodation/
├── concepts/
│   ├── hotyoga/
│   ├── namaste/
│   └── vibro/
├── copenhagen/
├── careers/
├── apply/
├── compare/
├── mentorship/
├── link/
├── schedule/
├── member/
└── journal/
```

### 3. Use in Templates

The media map is in `src/_data/media.json`. Use these patterns:

```nunjucks
{# Simple image URL (for background-image, src attributes, etc.) #}
{{ media.homepage.inversionsCard | cloudimg }}
{{ media.homepage.inversionsCard | cloudimg("w_800,h_600,c_fill,f_auto,q_auto") }}

{# Full <img> tag with srcset, lazy loading, and dimensions #}
{% cldimg media.homepage.inversionsCard, "Inversions course Copenhagen", "w_800,c_fill,f_auto,q_auto", "800", "600" %}

{# Video URL #}
{{ media.homepage.heroVideo | cloudvid }}

{# Full <video> tag with poster #}
{% cldvid media.schedule.heroVideo, media.schedule.heroPoster, "w_1920,q_auto" %}
```

### 4. Common Transforms

| Transform | What it does |
|-----------|-------------|
| `f_auto,q_auto` | Auto format (WebP/AVIF) + auto quality (default) |
| `w_800,c_fill` | Resize to 800px wide, crop to fill |
| `w_800,h_600,c_fill,g_auto` | 800×600 with smart crop |
| `w_1200,c_limit` | Max 1200px wide, keep aspect ratio |
| `dpr_2.0` | Retina (2x) resolution |
| `e_blur:1000` | Placeholder blur (for LQIP) |

---

## Summary

| Category | Images | Videos | Total |
|----------|--------|--------|-------|
| Existing local files | 10 | 1 | 11 |
| External CDN (to download) | ~27 | 6 | ~33 |
| Missing local references | ~58 | 5 | ~63 |
| Journal default-image posts | 6 | 0 | 6 |
| Inline placeholder divs | 2 | 1 | 3 |
| Unsplash/Pravatar replacements | 7 | 0 | 7 |
| Favicons | 4 | 0 | 4 |
| **TOTAL unique assets** | **~114** | **~13** | **~127** |

---

## GLOBAL / BRAND (16 items)

| ID | Status | Current Source | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|---------------|----------------|---------------------|--------------|------------|------|-------------|
| G1 | EXISTS | `src/assets/images/brand/logo-orange-on-transparent.png` | — | `yoga-bible-DK/brand/` | `yoga-bible-logo-orange.png` | 180×44 | <10KB | Yoga Bible orange logo on transparent background |
| G2 | EXISTS | `src/assets/images/brand/logo-orange-on-transparent-2x.png` | — | `yoga-bible-DK/brand/` | `yoga-bible-logo-orange-2x.png` | 360×88 | <25KB | Yoga Bible orange logo retina |
| G3 | EXTERNAL CDN | `yogabible.dk/s/Yoga_Bible_App_Store.svg` | `src/assets/images/brand/` | `yoga-bible-DK/brand/` | `yoga-bible-app-store-badge.svg` | vector | <5KB | Download Yoga Bible DK on App Store |
| G4 | EXTERNAL CDN | `yogabible.dk/s/Yoga_Bible_App_Google_Play.svg` | `src/assets/images/brand/` | `yoga-bible-DK/brand/` | `yoga-bible-google-play-badge.svg` | vector | <5KB | Get Yoga Bible DK on Google Play |
| G5 | EXTERNAL CDN | `yogabible.dk/s/YOGA-BIBLE-FOOTER-2000-x-350-7ndy.svg` | `src/assets/images/brand/` | `yoga-bible-DK/brand/` | `yoga-bible-footer-wordmark.svg` | 2000×350 | <15KB | YOGA BIBLE large footer wordmark |
| G6 | EXTERNAL CDN | `yogabible.dk/s/Instagram_Glyph_Gradient.png` | `src/assets/images/brand/` | `yoga-bible-DK/brand/` | `instagram-glyph-gradient.png` | 28×28 | <5KB | Instagram icon |
| G7 | EXTERNAL CDN | `yogabible.dk/s/..._cloudmark-white-transparent.png` | `src/assets/images/brand/` | `yoga-bible-DK/brand/` | `soundcloud-logo-white.png` | 28×28 | <5KB | SoundCloud / Cloudmark icon |
| G8 | EXISTS | `src/assets/images/og/og-1200x630.png` | — | `yoga-bible-DK/brand/` | `yoga-bible-og-landscape.png` | 1200×630 | <50KB | Open Graph sharing image (landscape) |
| G9 | EXISTS | `src/assets/images/og/og-1200x1200.png` | — | `yoga-bible-DK/brand/` | `yoga-bible-og-square.png` | 1200×1200 | <50KB | Open Graph sharing image (square) |
| G10 | EXISTS | `src/favicon.ico` | — | `yoga-bible-DK/brand/` | `favicon.ico` | 32×32 | <5KB | Favicon ICO |
| G11 | EXISTS | `src/favicon-32x32.png` | — | `yoga-bible-DK/brand/` | `favicon-32x32.png` | 32×32 | <2KB | Favicon PNG 32px |
| G12 | EXISTS | `src/favicon-16x16.png` | — | `yoga-bible-DK/brand/` | `favicon-16x16.png` | 16×16 | <1KB | Favicon PNG 16px |
| G13 | EXISTS | `src/apple-touch-icon.png` | — | `yoga-bible-DK/brand/` | `apple-touch-icon.png` | 180×180 | <10KB | Apple Touch Icon |
| G14 | MISSING | ref in `member.njk` modal | `src/assets/images/member/` | `yoga-bible-DK/member/` | `yoga-registration-hero.jpg` | 600×900 | <80KB | Atmospheric yoga image for auth/registration modal sidebar |
| G15 | EXISTS | `src/assets/images/concepts/namaste-online-logo.png` | — | `yoga-bible-DK/concepts/namaste/` | `namaste-online-logo.png` | 400×200 | <20KB | Namaste Online platform logo |
| G16 | EXISTS | `src/assets/images/concepts/namaste-studios-logo.png` | — | `yoga-bible-DK/concepts/namaste/` | `namaste-studios-logo.png` | 400×200 | <20KB | Namaste Studios logo |

---

## HOMEPAGE — `index.njk` → `/` (5 items)

| ID | Status | Current Source | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|---------------|----------------|---------------------|--------------|------------|------|-------------|
| H1 | EXISTS | `src/assets/hero-loop.mp4` | — | `yoga-bible-DK/homepage/` | `yoga-bible-hero-loop.mp4` | 1920×1080 | <20MB | Hero background video: atmospheric yoga practice footage, looping |
| H2 | MISSING | ref in `index.njk:170` | `src/assets/images/courses/` | `yoga-bible-DK/homepage/` | `inversions-course-hero-copenhagen.jpg` | 800×600 | <100KB | Student performing inversions (handstand/forearm balance) in Copenhagen studio |
| H3 | MISSING | ref in `index.njk:193` | `src/assets/images/courses/` | `yoga-bible-DK/homepage/` | `splits-flexibility-course-hero.jpg` | 800×600 | <100KB | Student in splits or deep flexibility pose in studio |
| H4 | MISSING | ref in `index.njk:216` | `src/assets/images/courses/` | `yoga-bible-DK/homepage/` | `backbends-course-hero-yoga.jpg` | 800×600 | <100KB | Student in deep backbend (wheel pose or king pigeon) |
| H5 | MISSING | ref in `index.njk:239` | `src/assets/images/studio/` | `yoga-bible-DK/homepage/` | `yoga-bible-studio-panorama-torvegade.jpg` | 1600×700 | <150KB | Wide panoramic shot of Yoga Bible studio at Torvegade 66 |

---

## HOMEPAGE VARIANTS (7 items — lower priority, alternate layouts)

| ID | Status | Current Source | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|---------------|----------------|---------------------|--------------|------------|------|-------------|
| HP1 | MISSING | `homepage1.njk` | `src/assets/images/` | `yoga-bible-DK/homepage/` | `yoga-hero-video-poster.jpg` | 1920×1080 | <200KB | Hero video poster/fallback: yoga practice scene |
| HP2 | MISSING | `homepage1.njk` | `src/assets/images/` | `yoga-bible-DK/homepage/` | `yoga-bible-studio-interior.jpg` | 1600×900 | <150KB | Yoga Bible studio interior wide shot |
| HP3 | MISSING | `homepage1.njk` | `src/assets/images/` | `yoga-bible-DK/homepage/` | `yoga-teacher-training-path.jpg` | 800×600 | <100KB | Teacher guiding a student in yoga pose |
| HP4 | MISSING | `homepage1.njk` | `src/assets/images/` | `yoga-bible-DK/homepage/` | `personal-yoga-practice-flow.jpg` | 800×600 | <100KB | Solo practitioner in dynamic flow |
| HP5 | MISSING | `homepage2.njk` | `src/assets/images/` | `yoga-bible-DK/homepage/` | `yoga-hero-portrait-dramatic.jpg` | 1200×1600 | <200KB | Portrait-orientation hero: yoga practitioner in dramatic pose |
| HP6 | MISSING | `homepage2.njk` | `src/assets/images/` | `yoga-bible-DK/homepage/` | `yoga-bible-studio-alternate.jpg` | 1600×900 | <150KB | Studio atmosphere shot, alternate angle |
| HP7 | MISSING | `homepage4.njk` | `src/assets/images/` | `yoga-bible-DK/homepage/` | `yoga-cinematic-hero-scene.jpg` | 1920×1080 | <200KB | Hero background: cinematic yoga scene |

---

## 18-WEEK PROGRAM — `p18w.njk` → `/yogauddannelse-18-uger/` (14 items)

| ID | Status | Current Source | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|---------------|----------------|---------------------|--------------|------------|------|-------------|
| P18-1 | IFRAME | `drive.google.com/file/d/1WWanYni0tZKJ656czw_N2Vf6thCKFwU8` | N/A | `yoga-bible-DK/programs/` | (Google Drive embed) | responsive | streaming | Student testimonial/promo video for yoga teacher training |
| P18-2 | EXTERNAL CDN | `yogabible.dk/s/Bliv-Yogalrer_..._Weekday_W.mp4` | `src/assets/video/` | `yoga-bible-DK/programs/` | `yoga-students-share-training-experience.mp4` | 1920×1080 | <30MB | Former students sharing experiences from 18-week yoga teacher training |
| P18-3 | MISSING | ref in `p18w.njk:374` | `src/assets/video/` | `yoga-bible-DK/programs/` | `yoga-practice-session-loop.mp4` | 1920×1080 | <15MB | Looping video: yoga practice session in studio |
| P18-4 | EXTERNAL CDN | `yogabible.dk/s/Yoga_bible_studio_..._Copenhagen01` | `src/assets/images/studio/` | `yoga-bible-DK/studio/` | `yoga-bible-studio-hot-room-copenhagen.jpg` | 1200×800 | <120KB | Yoga Bible hot yoga studio with warm wooden floor |
| P18-5 | EXTERNAL CDN | `yogabible.dk/s/Yoga_bible_studio_..._Training_space02` | `src/assets/images/studio/` | `yoga-bible-DK/studio/` | `yoga-bible-training-room-daylight.jpg` | 1200×800 | <120KB | Bright yoga training room with daylight and plants |
| P18-6 | EXTERNAL CDN | `yogabible.dk/s/Yoga_Bible_Studio_Torvegade_66_Christianshavn` | `src/assets/images/studio/` | `yoga-bible-DK/studio/` | `yoga-bible-studio-torvegade-66-entrance.jpg` | 1200×800 | <120KB | Yoga Bible studio reception/entrance at Torvegade 66 |
| P18-7 | EXTERNAL CDN | `yogabible.dk/s/Yoga_bible_shower_facilities` | `src/assets/images/studio/` | `yoga-bible-DK/studio/` | `yoga-bible-shower-changing-facilities.jpg` | 1200×800 | <100KB | Studio shower and changing facilities |
| P18-8 | EXTERNAL CDN | `yogabible.dk/s/Christianshavn_Yoga_Bible_Central_Location.jpg` | `src/assets/images/location/` | `yoga-bible-DK/studio/` | `christianshavn-canal-yoga-bible-location.jpg` | 1200×800 | <120KB | Christianshavn canal with colourful houses near studio |
| P18-9 | EXTERNAL CDN | `yogabible.dk/s/christianshavn_metro_Station_..._02.jpeg` | `src/assets/images/location/` | `yoga-bible-DK/studio/` | `christianshavn-metro-station-exterior.jpg` | 1200×800 | <100KB | Christianshavn Metro station, 2 min walk from studio |
| P18-10 | EXTERNAL CDN | `yogabible.dk/s/christianshavn_metro_Station_...jpeg` | `src/assets/images/location/` | `yoga-bible-DK/studio/` | `copenhagen-night-near-yoga-studio.jpg` | 1200×800 | <100KB | Copenhagen by night near the studio area |
| P18-11 | EXTERNAL CDN | `yogabible.dk/s/Inversions_Course_Copenhagen.jpg` | `src/assets/images/courses/` | `yoga-bible-DK/courses/inversions/` | `inversions-course-copenhagen-promo.jpg` | 1500×1000 | <150KB | Inversions course promotional image |
| P18-12 | EXTERNAL CDN | `yogabible.dk/s/200timer-Yoga-Education-Kbenhavn.png` | `src/assets/images/courses/` | `yoga-bible-DK/courses/` | `200-hour-yoga-education-copenhagen.png` | 1500×1000 | <150KB | 200-hour yoga teacher training promo |
| P18-13 | EXTERNAL CDN | `yogabible.dk/s/Splits_Course_Kursus_Kbenhavn_Copenhagen.jpg` | `src/assets/images/courses/` | `yoga-bible-DK/courses/` | `splits-course-copenhagen-promo.jpg` | 1500×1000 | <150KB | Splits flexibility course promotional image |
| P18-14 | EXTERNAL CDN | `yogabible.dk/s/professional-backbend-yoga-training-copenhagen.jpg` | `src/assets/images/courses/` | `yoga-bible-DK/courses/` | `professional-backbend-training-copenhagen.jpg` | 1500×1000 | <150KB | Backbends course promotional image |

---

## 4-WEEK PROGRAM — `p4w.njk` → `/yogauddannelse-4-uger/` (6 unique + reuses P18)

| ID | Status | Current Source | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|---------------|----------------|---------------------|--------------|------------|------|-------------|
| P4-1 | IFRAME | Same Google Drive embed as P18-1 | N/A | — | — | responsive | streaming | Same testimonial video |
| P4-2 | MISSING | ref in `p4w.njk:139` | `src/assets/images/p4w/` | `yoga-bible-DK/programs/p4w/` | `yoga-alliance-ryt200-certificate-sample.jpg` | 800×600 | <80KB | Sample Yoga Alliance RYT-200 certificate |
| P4-3 | MISSING | ref in `p4w.njk:531` | `src/assets/images/p4w/` | `yoga-bible-DK/programs/p4w/` | `studio-apartment-christianshavn-copenhagen.jpg` | 800×600 | <80KB | Private studio apartment in Christianshavn for yoga students |
| P4-4 | MISSING | ref in `p4w.njk:532` | `src/assets/images/p4w/` | `yoga-bible-DK/programs/p4w/` | `studio-apartment-kitchenette-copenhagen.jpg` | 800×600 | <80KB | Studio apartment kitchenette in Copenhagen |
| P4-5 | MISSING | ref in `p4w.njk:550` | `src/assets/images/p4w/` | `yoga-bible-DK/programs/p4w/` | `shared-apartment-private-room-copenhagen.jpg` | 800×600 | <80KB | Private room in shared yoga student apartment |
| P4-6 | MISSING | ref in `p4w.njk:551` | `src/assets/images/p4w/` | `yoga-bible-DK/programs/p4w/` | `shared-apartment-common-area-copenhagen.jpg` | 800×600 | <80KB | Shared apartment common area and kitchen |
| — | REUSES | P18-4 through P18-14 | — | — | — | — | — | All studio, location, and course card images from 18-week |

---

## 8-WEEK PROGRAM — `p8w.njk` → `/yogauddannelse-8-uger/` (reuses P4 + P18)

All images reused from 4-week (P4-2 through P4-6) and 18-week (P18-4 through P18-14). No unique images needed.

---

## ACCOMMODATION — `accommodation.njk` → `/bolig/` (21 items)

| ID | Status | Current Source | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|---------------|----------------|---------------------|--------------|------------|------|-------------|
| A1 | MISSING | ref in `accommodation.njk:112` | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `yoga-student-accommodation-copenhagen-hero.jpg` | 1600×685 | <150KB | Hero: Copenhagen accommodation for yoga students, aerial/panoramic |
| A2 | PLACEHOLDER | div in template | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `yoga-student-apartment-living-copenhagen.jpg` | 800×1000 | <100KB | Yoga student relaxing in bright Copenhagen apartment living room |
| A3 | EXTERNAL CDN | `yogabible.dk/s/Yoga-Teacher-Training-Copenhagen-Accommodation-Single-Studio-Apartment.jpg` | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `single-studio-apartment-overview.jpg` | 1200×800 | <120KB | Single studio apartment for yoga students — interior overview |
| A4 | EXTERNAL CDN | `yogabible.dk/s/Single-Studio-Apartment-01.jpg` | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `single-studio-apartment-bedroom.jpg` | 1200×800 | <100KB | Single studio apartment Copenhagen — bedroom |
| A5 | EXTERNAL CDN | `yogabible.dk/s/Single-Studio-Apartment-03.jpg` | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `single-studio-apartment-kitchen.jpg` | 1200×800 | <100KB | Studio apartment kitchen yoga student accommodation |
| A6 | EXTERNAL CDN | `yogabible.dk/s/Single-Studio-Apartment-02.jpg` | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `single-studio-apartment-bathroom.jpg` | 1200×800 | <100KB | Single studio apartment bathroom |
| A7 | EXTERNAL CDN | `yogabible.dk/s/Single-Studio-Apartment-04.jpg` | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `single-studio-apartment-workspace.jpg` | 1200×800 | <100KB | Single studio apartment workspace and living area |
| A8 | EXTERNAL CDN | `yogabible.dk/s/Double-Private-Bedroom-03.jpg` | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `shared-apartment-bedroom-copenhagen.jpg` | 1200×800 | <100KB | Shared apartment private bedroom |
| A9 | EXTERNAL CDN | `yogabible.dk/s/Double-Private-Bedroom-01.jpg` | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `shared-apartment-private-room.jpg` | 1200×800 | <100KB | Shared apartment private bedroom alternate view |
| A10 | EXTERNAL CDN | `yogabible.dk/s/Double-Private-Bedroom-07.jpg` | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `shared-apartment-common-area.jpg` | 1200×800 | <100KB | Shared apartment common area yoga accommodation |
| A11 | EXTERNAL CDN | `yogabible.dk/s/Double-Private-Bedroom-02.jpg` | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `shared-apartment-bathroom-kitchen.jpg` | 1200×800 | <100KB | Double studio bathroom and kitchen |
| A12 | EXTERNAL CDN | `yogabible.dk/s/Double-Private-Bedroom-04.jpg` | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `shared-apartment-living-space.jpg` | 1200×800 | <100KB | Shared yoga student accommodation living space |
| A13 | PLACEHOLDER | div in template | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `yoga-student-cooking-copenhagen-kitchen.jpg` | 800×1000 | <100KB | Yoga student cooking in Copenhagen apartment kitchen |
| A14 | PLACEHOLDER | div in template | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `hotel-cph-living-floating-copenhagen.jpg` | 600×400 | <60KB | CPH Living floating hotel exterior on Copenhagen harbor |
| A15 | PLACEHOLDER | div in template | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `hotel-25hours-paper-island-copenhagen.jpg` | 600×400 | <60KB | 25hours Hotel Paper Island Copenhagen exterior |
| A16 | PLACEHOLDER | div in template | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `hostel-generator-copenhagen.jpg` | 600×400 | <60KB | Generator Hostel Copenhagen exterior or lobby |
| A17 | PLACEHOLDER | div in template | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `hostel-steel-house-copenhagen.jpg` | 600×400 | <60KB | Steel House Copenhagen hostel exterior or common area |
| A18 | PLACEHOLDER | div in template | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `course-4-week-intensive-yoga-training.jpg` | 600×400 | <60KB | 4-week intensive yoga teacher training promo card |
| A19 | PLACEHOLDER | div in template | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `course-8-week-semi-intensive-yoga.jpg` | 600×400 | <60KB | 8-week semi-intensive yoga teacher training promo card |
| A20 | PLACEHOLDER | div in template | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `course-bundles-yoga-specialty-training.jpg` | 600×400 | <60KB | Course bundles specialty training promo card |
| A21 | IFRAME | Google Maps embed | N/A | — | — | responsive | — | Google Maps: Torvegade 66, Copenhagen |

---

## INVERSIONS — `inversions.njk` → `/inversions-kursus/` (11 items)

| ID | Status | Current Source | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|---------------|----------------|---------------------|--------------|------------|------|-------------|
| INV1 | MISSING | ref in `inversions.njk:99` | `src/assets/images/inversions/` | `yoga-bible-DK/courses/inversions/` | `inversions-yoga-course-hero.jpg` | 1600×900 | <150KB | Hero: dramatic inversions pose (handstand, forearm balance) |
| INV2 | MISSING | ref in `inversions.njk:406` | `src/assets/images/inversions/` | `yoga-bible-DK/courses/inversions/` | `inversions-video-poster-thumbnail.jpg` | 1200×675 | <100KB | Video poster: still frame from inversions reel |
| INV3 | EXTERNAL CDN | `yogabible.dk/s/inversions_reel_sub.mp4` | `src/assets/video/` | `yoga-bible-DK/courses/inversions/` | `inversions-course-reel-subtitled.mp4` | 1080×1920 | <15MB | Inversions course reel video with subtitles |
| INV4 | EXTERNAL CDN | `yogabible.dk/s/Try-again-Yoga-Bible-Web-Inversions-Kursus.mov` | `src/assets/video/` | `yoga-bible-DK/courses/inversions/` | `inversions-course-full-demo.mp4` | 1920×1080 | <20MB | Inversions course full demo/promo video |
| INV5 | MISSING | ref in `inversions.njk:1312` | `src/assets/images/inversions/` | `yoga-bible-DK/courses/inversions/` | `anna-herceg-inversions-instructor.jpg` | 600×800 | <80KB | Anna Herceg, inversions instructor portrait |
| INV6 | MISSING | ref in `inversions.njk:1392` | `src/assets/images/inversions/` | `yoga-bible-DK/courses/inversions/` | `inversions-gallery-handstand-variation.jpg` | 600×600 | <70KB | Inversions gallery: handstand variation |
| INV7 | MISSING | ref in `inversions.njk:1395` | `src/assets/images/inversions/` | `yoga-bible-DK/courses/inversions/` | `inversions-gallery-forearm-balance.jpg` | 600×600 | <70KB | Inversions gallery: forearm balance |
| INV8 | MISSING | ref in `inversions.njk:1398` | `src/assets/images/inversions/` | `yoga-bible-DK/courses/inversions/` | `inversions-gallery-shoulder-stand.jpg` | 600×600 | <70KB | Inversions gallery: shoulder stand |
| INV9 | MISSING | ref in `inversions.njk:1401` | `src/assets/images/inversions/` | `yoga-bible-DK/courses/inversions/` | `inversions-gallery-headstand-variation.jpg` | 600×600 | <70KB | Inversions gallery: headstand variation |
| INV10 | MISSING | ref in `inversions.njk:1404` | `src/assets/images/inversions/` | `yoga-bible-DK/courses/inversions/` | `inversions-gallery-spotter-assisted.jpg` | 600×600 | <70KB | Inversions gallery: spotter-assisted practice |
| INV11 | MISSING | ref in `inversions.njk:1407` | `src/assets/images/inversions/` | `yoga-bible-DK/courses/inversions/` | `inversions-gallery-group-class.jpg` | 600×600 | <70KB | Inversions gallery: group inversions class |

---

## CONCEPTS — `concepts.njk` → `/koncepter/` (22 items)

### Hot Yoga Copenhagen (10)

| ID | Status | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|----------------|---------------------|--------------|------------|------|-------------|
| C1 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/` | `yoga-concepts-hero-background.jpg` | 1920×1080 | <200KB | Full-width concepts page hero background |
| C2 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/hotyoga/` | `hot-yoga-copenhagen-studio-session.jpg` | 800×600 | <80KB | Hot Yoga Copenhagen hero: heated studio session |
| C3 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/hotyoga/` | `infrared-heating-yoga-studio.jpg` | 700×500 | <70KB | Infrared heating technology panels in yoga studio |
| C4 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/hotyoga/` | `frozen-towel-hot-yoga-shavasana.jpg` | 600×340 | <50KB | Frozen towel for post-hot-yoga shavasana |
| C5 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/hotyoga/` | `sonic-shavasana-sound-healing.jpg` | 600×340 | <50KB | Sonic shavasana with sound healing bowls |
| C6 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/hotyoga/` | `ginger-shots-yoga-recovery.jpg` | 600×340 | <50KB | Fresh ginger shots and recovery drinks |
| C7 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/hotyoga/` | `herbal-tea-yoga-studio.jpg` | 600×340 | <50KB | Signature herbal tea service at studio |
| C8 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/hotyoga/` | `premium-hot-yoga-membership.jpg` | 600×340 | <50KB | Premium membership experience at Hot Yoga CPH |
| C9 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/hotyoga/` | `curated-soundscape-yoga-studio.jpg` | 600×340 | <50KB | Curated soundscape / speaker setup in yoga studio |
| C10 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/hotyoga/` | `hot-yoga-copenhagen-promo.mp4` | 1920×1080 | <15MB | Hot Yoga Copenhagen promotional video |

### Namaste Online (7)

| ID | Status | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|----------------|---------------------|--------------|------------|------|-------------|
| C11 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/namaste/` | `namaste-online-yoga-streaming-hero.jpg` | 800×600 | <80KB | Namaste Online hero: teacher streaming class |
| C12 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/namaste/` | `live-online-yoga-class-session.jpg` | 600×400 | <60KB | Live online yoga class in progress |
| C13 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/namaste/` | `yoga-teacher-streaming-from-studio.jpg` | 600×400 | <60KB | Teacher streaming yoga class from studio |
| C14 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/namaste/` | `at-home-yoga-practitioner-online.jpg` | 600×400 | <60KB | At-home practitioner following online class |
| C15 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/namaste/` | `namaste-online-platform-demo.mp4` | 1920×1080 | <15MB | Namaste Online platform demo video |

### Vibro Yoga (5)

| ID | Status | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|----------------|---------------------|--------------|------------|------|-------------|
| C16 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/vibro/` | `vibro-yoga-vibration-platform-hero.jpg` | 800×600 | <80KB | Vibro Yoga hero: vibration platform session |
| C17 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/vibro/` | `vibro-yoga-studio-setup.jpg` | 600×400 | <60KB | Vibro Yoga studio setup with platforms |
| C18 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/vibro/` | `vibro-yin-yoga-session.jpg` | 600×400 | <60KB | Vibro Yin session in progress on vibration platforms |
| C19 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/vibro/` | `vibration-shower-experience.jpg` | 600×400 | <60KB | Vibration shower experience |
| C20 | MISSING | `src/assets/images/concepts/` | `yoga-bible-DK/concepts/vibro/` | `vibro-yoga-concept-demo.mp4` | 1920×1080 | <15MB | Vibro Yoga concept demo video |

---

## ABOUT COPENHAGEN — `about_copenhagen.njk` → `/om-koebenhavn/` (14 items)

| ID | Status | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|----------------|---------------------|--------------|------------|------|-------------|
| CPH1 | MISSING | `src/assets/images/copenhagen/` | `yoga-bible-DK/copenhagen/` | `copenhagen-skyline-hero.jpg` | 1600×685 | <150KB | Copenhagen skyline or iconic scene (Nyhavn, canal view) |
| CPH2 | MISSING | `src/assets/images/copenhagen/` | `yoga-bible-DK/copenhagen/` | `copenhagen-bike-culture-cyclists.jpg` | 900×600 | <80KB | Copenhagen bicycle culture, cyclists on bridge |
| CPH3 | MISSING | `src/assets/images/copenhagen/` | `yoga-bible-DK/copenhagen/` | `copenhagen-hygge-cafe-scene.jpg` | 900×600 | <80KB | Cozy Copenhagen cafe or hygge scene |
| CPH4 | MISSING | `src/assets/images/copenhagen/` | `yoga-bible-DK/copenhagen/` | `danish-saunagus-sauna-culture.jpg` | 900×600 | <80KB | Danish saunagus / sauna culture |
| CPH5 | MISSING | `src/assets/images/copenhagen/` | `yoga-bible-DK/copenhagen/` | `copenhagen-cold-water-swimming.jpg` | 900×600 | <80KB | Cold water swimming / harbor bath Copenhagen |
| CPH6 | MISSING | `src/assets/images/copenhagen/` | `yoga-bible-DK/copenhagen/` | `copenhagen-music-concert-scene.jpg` | 900×600 | <80KB | Copenhagen music/concert scene |
| CPH7 | MISSING | `src/assets/images/copenhagen/` | `yoga-bible-DK/copenhagen/` | `scandinavian-design-interior.jpg` | 900×600 | <80KB | Scandinavian design interior or architecture |
| CPH8 | MISSING | `src/assets/images/copenhagen/` | `yoga-bible-DK/copenhagen/` | `copenhagen-green-spaces-parks.jpg` | 900×600 | <80KB | Copenhagen parks or green spaces |
| CPH9 | MISSING | `src/assets/images/copenhagen/` | `yoga-bible-DK/copenhagen/` | `copenhagen-new-nordic-food-scene.jpg` | 900×600 | <80KB | Copenhagen food scene / New Nordic cuisine |
| CPH10 | MISSING | `src/assets/images/copenhagen/` | `yoga-bible-DK/copenhagen/` | `christianshavn-canal-panorama.jpg` | 1600×667 | <150KB | Christianshavn canal panoramic, near Yoga Bible studio |
| CPH11 | MISSING | `src/assets/images/studio/` | `yoga-bible-DK/studio/` | `yoga-bible-hot-yoga-studio-room.jpg` | 900×600 | <80KB | Yoga Bible hot yoga studio room |
| CPH12 | MISSING | `src/assets/images/studio/` | `yoga-bible-DK/studio/` | `yoga-bible-main-practice-room.jpg` | 900×600 | <80KB | Yoga Bible main practice room |
| CPH13 | MISSING | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `copenhagen-studio-apartment-yoga-student.jpg` | 900×600 | <80KB | Studio apartment for about-copenhagen section |
| CPH14 | MISSING | `src/assets/images/accommodation/` | `yoga-bible-DK/accommodation/` | `copenhagen-shared-apartment-yoga-student.jpg` | 900×600 | <80KB | Shared apartment for about-copenhagen section |

---

## WEEKLY SCHEDULE — `weekly_schedule.njk` → `/ugeplan/` (3 unique)

| ID | Status | Current Source | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|---------------|----------------|---------------------|--------------|------------|------|-------------|
| WS1 | EXTERNAL CDN | `yogabible.dk/s/Yoga-practice-man-01.mp4` | `src/assets/video/` | `yoga-bible-DK/schedule/` | `yoga-practice-hero-loop.mp4` | 1920×1080 | <15MB | Hero: male yoga practitioner flowing through poses |
| WS2 | EXTERNAL CDN | `yogabible.dk/s/Yoga-Bible-hot-yoga-copenhagen-app.mov` | `src/assets/video/` | `yoga-bible-DK/schedule/` | `yoga-bible-app-demo-mobile.mp4` | 390×844 | <10MB | App demo: Hot Yoga Copenhagen / Yoga Bible app walkthrough |
| — | REUSES | G3, G4 (App Store badges), P18-11/12/13/14 (course cards) | — | — | — | — | — | Shared assets |

---

## CAREERS — `careers.njk` → `/karriere/` (2 items)

| ID | Status | Current Source | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|---------------|----------------|---------------------|--------------|------------|------|-------------|
| CAR1 | EXTERNAL CDN | `yogabible.dk/s/DSC_8528.jpg` | `src/assets/images/careers/` | `yoga-bible-DK/careers/` | `yoga-teaching-careers-hero-poster.jpg` | 1080×1920 | <150KB | Careers hero video poster: yoga teaching scene |
| CAR2 | EXTERNAL CDN | `yogabible.dk/s/careers-vertical.mp4` | `src/assets/video/` | `yoga-bible-DK/careers/` | `yoga-careers-hero-vertical.mp4` | 1080×1920 | <10MB | Careers vertical hero video of yoga teaching |

---

## APPLY — `apply.njk` → `/ansog/` (1 item)

| ID | Status | Current Source | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|---------------|----------------|---------------------|--------------|------------|------|-------------|
| APP1 | EXTERNAL CDN | `yogabible.dk/s/Beth-02.jpg` | `src/assets/images/careers/` | `yoga-bible-DK/apply/` | `beth-yoga-instructor-portrait.jpg` | 800×1200 | <100KB | Beth, yoga instructor, application page hero portrait |

---

## COMPARE — `compare.njk` → `/sammenlign/` (3 items)

| ID | Status | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|----------------|---------------------|--------------|------------|------|-------------|
| CMP1 | MISSING | `src/assets/images/compare/` | `yoga-bible-DK/compare/` | `teacher-profile-lifelong-learner.jpg` | 120×120 | <15KB | Teacher profile avatar: lifelong learner persona |
| CMP2 | MISSING | `src/assets/images/compare/` | `yoga-bible-DK/compare/` | `teacher-profile-midcareer-changer.jpg` | 120×120 | <15KB | Teacher profile avatar: mid-career changer persona |
| CMP3 | MISSING | `src/assets/images/compare/` | `yoga-bible-DK/compare/` | `teacher-profile-rising-teacher.jpg` | 120×120 | <15KB | Teacher profile avatar: rising teacher persona |

---

## MENTORSHIP — `mentorship.njk` → `/mentorordning/` (2 items)

| ID | Status | Current Source | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|---------------|----------------|---------------------|--------------|------------|------|-------------|
| MEN1 | EXTERNAL CDN | `yogabible.dk/s/mentor_03_private_class_inversions_course.jpg` | `src/assets/images/` | `yoga-bible-DK/mentorship/` | `private-mentorship-inversions-session.jpg` | 1200×800 | <120KB | Mentor guiding student in private inversions session |
| MEN2 | PLACEHOLDER | OG image used as fallback | — | `yoga-bible-DK/mentorship/` | `mentorship-practice-video-poster.jpg` | 1200×630 | <100KB | Custom poster for mentorship practice videos |

---

## LINK PAGE — `link.njk` → `/link/` (2 items)

| ID | Status | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|----------------|---------------------|--------------|------------|------|-------------|
| LNK1 | MISSING | `src/assets/images/link/` | `yoga-bible-DK/link/` | `yoga-bible-link-hero-vertical.mp4` | 1080×1920 | <8MB | Link page hero: vertical looping yoga video |
| LNK2 | MISSING | `src/assets/images/link/` | `yoga-bible-DK/link/` | `yoga-bible-link-hero-poster.jpg` | 1080×1920 | <100KB | Link page hero video poster/fallback image |

---

## SPLITS — `splits.njk` → `/splits-kursus/` (1 item)

| ID | Status | Current Source | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|---------------|----------------|---------------------|--------------|------------|------|-------------|
| SPL1 | EXTERNAL CDN | `yogabible.dk/s/Splits_Course_Kursus_Kbenhavn_Copenhagen.jpg` | `src/assets/images/courses/` | `yoga-bible-DK/courses/` | `splits-course-copenhagen-promo.jpg` | 1500×1000 | <150KB | Splits course promotional hero image (same as P18-13) |

---

## BACKBENDS — `backbends.njk` → `/backbends-kursus/` (1 item)

| ID | Status | Current Source | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|---------------|----------------|---------------------|--------------|------------|------|-------------|
| BB1 | EXTERNAL CDN | `yogabible.dk/s/professional-backbend-yoga-training-copenhagen.jpg` | `src/assets/images/courses/` | `yoga-bible-DK/courses/` | `professional-backbend-training-copenhagen.jpg` | 1500×1000 | <150KB | Backbends course promotional hero image (same as P18-14) |

---

## JOURNAL — `journals.json` (12 items)

### Featured images for posts

| ID | Status | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|----------------|---------------------|--------------|------------|------|-------------|
| J1 | MISSING | `src/assets/images/journal/` | `yoga-bible-DK/journal/` | `18-ugers-yogalaereruddannelse-fleksibelt-program.jpg` | 1200×630 | <100KB | 18-week flexible yoga teacher training article hero |
| J2 | DEFAULT OG | `src/assets/images/journal/` | `yoga-bible-DK/journal/` | `hvad-er-vinyasa-yoga.jpg` | 1200×630 | <100KB | What is Vinyasa yoga — flowing practice |
| J3 | DEFAULT OG | `src/assets/images/journal/` | `yoga-bible-DK/journal/` | `5-aandedraetsteknikker-for-begyndere.jpg` | 1200×630 | <100KB | 5 breathing techniques for beginners |
| J4 | DEFAULT OG | `src/assets/images/journal/` | `yoga-bible-DK/journal/` | `de-syv-chakraer-forklaret.jpg` | 1200×630 | <100KB | The seven chakras explained |
| J5 | DEFAULT OG | `src/assets/images/journal/` | `yoga-bible-DK/journal/` | `yoga-og-mental-sundhed.jpg` | 1200×630 | <100KB | Yoga and mental health |
| J6 | DEFAULT OG | `src/assets/images/journal/` | `yoga-bible-DK/journal/` | `guide-til-din-foerste-yogalaereruddannelse.jpg` | 1200×630 | <100KB | Guide to your first yoga teacher training |
| J7 | DEFAULT OG | `src/assets/images/journal/` | `yoga-bible-DK/journal/` | `fordelene-ved-hot-yoga.jpg` | 1200×630 | <100KB | Benefits of hot yoga |

### Inline content media (in 18-week article)

| ID | Status | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|----------------|---------------------|--------------|------------|------|-------------|
| J8 | PLACEHOLDER DIV | `src/assets/images/journal/` | `yoga-bible-DK/journal/` | `yoga-bible-studio-morning-flow.jpg` | 1200×675 | <100KB | Students in Yoga Bible studio during morning flow class |
| J9 | PLACEHOLDER DIV | `src/assets/video/journal/` | `yoga-bible-DK/journal/` | `students-teaching-each-other-loop.mp4` | 1920×1080 | <10MB | Silent loop: students teaching each other in pairs |
| J10 | PLACEHOLDER DIV | `src/assets/images/journal/` | `yoga-bible-DK/journal/` | `yoga-bible-studio-panorama-torvegade.jpg` | 1600×685 | <150KB | Panoramic photo of Yoga Bible studio at Torvegade 66 |

---

## VIBRO YOGA DESIGN — `vibroyogadesign.njk` (7 items)

| ID | Status | Current Source | Drop File Here | Cloudinary Upload Path | SEO Filename | Dimensions | Size | Description |
|----|--------|---------------|----------------|---------------------|--------------|------------|------|-------------|
| VYD1 | UNSPLASH | `unsplash.com/photo-1545389336-cf090694435e` | `src/assets/images/vibroyogadesign/` | `yoga-bible-DK/vibroyogadesign/` | `vibro-yoga-session-hero.jpg` | 1920×1080 | <200KB | Vibro Yoga session hero image |
| VYD2 | UNSPLASH | `unsplash.com/photo-1506126613408-eca07ce68773` | `src/assets/images/vibroyogadesign/` | `yoga-bible-DK/vibroyogadesign/` | `vibro-yoga-platform-studio.jpg` | 800×600 | <80KB | Vibro Yoga platform in studio |
| VYD3 | UNSPLASH | `unsplash.com/photo-1544367567-0f2fcb009e0b` | `src/assets/images/vibroyogadesign/` | `yoga-bible-DK/vibroyogadesign/` | `vibro-yoga-studio-environment.jpg` | 800×600 | <80KB | Vibro Yoga studio environment |
| VYD4 | UNSPLASH | `unsplash.com/photo-1599901860904-17e6ed7083a0` | `src/assets/images/vibroyogadesign/` | `yoga-bible-DK/vibroyogadesign/` | `vibro-yin-yoga-session.jpg` | 600×400 | <60KB | Vibro Yin yoga session |
| VYD5 | PRAVATAR | `i.pravatar.cc/100?img=47` | `src/assets/images/vibroyogadesign/` | `yoga-bible-DK/vibroyogadesign/` | `testimonial-avatar-1.jpg` | 100×100 | <10KB | Testimonial avatar 1 |
| VYD6 | PRAVATAR | `i.pravatar.cc/100?img=12` | `src/assets/images/vibroyogadesign/` | `yoga-bible-DK/vibroyogadesign/` | `testimonial-avatar-2.jpg` | 100×100 | <10KB | Testimonial avatar 2 |
| VYD7 | PRAVATAR | `i.pravatar.cc/100?img=32` | `src/assets/images/vibroyogadesign/` | `yoga-bible-DK/vibroyogadesign/` | `testimonial-avatar-3.jpg` | 100×100 | <10KB | Testimonial avatar 3 |

---

## LIVE — `live.njk` → `/live/` (streaming service)

| ID | Status | Current Source | Description |
|----|--------|---------------|-------------|
| LIV1 | MUX STREAM | `mux-player` web component, playback ID in `src/_data/mux.json` | Mux livestream player for live yoga classes — no file needed |

---

## PAGES WITH NO MEDIA (no action needed)

- Yoga Photography (`yogaphotography.njk`) — will need media when content is added
- Yoga Bible Historie (`yoga-bible-historie.njk`)
- Yoga Music (`yogamusic.njk`)
- Om 200hrs (`om200.njk`)
- P300 (`p300.njk`)
- Homepage 3 (`homepage3.njk`) — inline SVG only
- Vibro Yoga Showcase (`vibroyoga-showcase.njk`) — JS-driven
- Kontakt (`kontakt.njk`) — form only
- Code of Conduct, Privacy Policy, Terms & Conditions — text only
- 404 — text only
- Admin, Profile, Member, Course Viewer, Yoga Glossary — no media
