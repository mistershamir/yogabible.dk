# Cloudinary Media Checklist

**Cloud:** `ddcynsa30` | **Root folder:** `yoga-bible-DK/`
**Upload URL:** https://console.cloudinary.com/app/ddcynsa30/media_library
**Last audited:** 2026-03-07

Upload each file to the matching Cloudinary folder below. Naming convention: lowercase, hyphens, no extension needed (Cloudinary auto-detects format).

### How to read this checklist

- Items are grouped by **business priority** — what hurts revenue most if missing
- Each item shows: Cloudinary path, size spec, type, and what it's used for
- `[MISSING FROM media.json]` = hardcoded in template/i18n, should be centralized
- `[IN media.json]` = properly referenced via `media.section.key`
- `[NO CLOUD]` = blog post with no Cloudinary image (uses fallback OG)

---

# PRIORITY 1 — REVENUE-CRITICAL (Enrollment & Conversion Pages)

These pages directly drive teacher training enrollment and course purchases. Missing media here = lost revenue.

---

## 1A. Homepage (17 assets) — First impression, all traffic lands here

### Hero (1 image + 1 video) — [IN media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 1 | `yoga-bible-DK/homepage/yoga-bible-studio-panorama-torvegade` | 1920x1080 | image | Hero poster/fallback. Dark, cinematic studio interior. |
| 2 | `yoga-bible-DK/homepage/yoga-bible-hero-loop` | 1920x1080 | VIDEO | Auto-playing hero background loop. Silent, dark-toned, 10-20s. |

### The Fork — Choose Your Path (2 images) — [IN media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 3 | `200-hour-yoga-education-copenhagen_kfp7hz` | 1200x800 | image | Left: "Become a Yoga Teacher." Works under dark gradient overlay. |
| 4 | `yoga-bible-DK/courses/inversions-course-copenhagen-promo` | 1200x800 | image | Right: "Deepen Your Practice." Dynamic inversion pose. |

### Specialty Courses Triptych (3 images) — [IN media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 5 | `media.homepage.inversionsCard_g08t2r` | 800x900 | image | Portrait. Handstand/arm balance. Dark gradient overlay at bottom. |
| 6 | `media.homepage.splitsCard_pd1wqz` | 800x900 | image | Portrait. Front/middle split. |
| 7 | `media.homepage.backbendsCard_pr2d1n` | 800x900 | image | Portrait. Wheel pose/deep backbend. |

### Studio & Community (1 video) — [IN media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 8 | `yoga-bible-DK/homepage/yoga-practice-copenhagen-studio-loop` | 1920x1080 | VIDEO | Silent yoga class loop, 10-20s. Dark overlay covers ~60%. |

### Copenhagen Cinema (6 images) — [IN media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 9 | `yoga-bible-DK/copenhagen/christianshavn-canal-panorama` | 1920x1080 | image | Full-bleed canal panorama + 120x120 thumbnail auto-crop. |
| 10 | `yoga-bible-DK/copenhagen/copenhagen-bike-culture-cyclists` | 400x400 | image | Thumbnail: cyclists. |
| 11 | `yoga-bible-DK/copenhagen/danish-saunagus-sauna-culture` | 400x400 | image | Thumbnail: sauna/cold water. |
| 12 | `yoga-bible-DK/copenhagen/copenhagen-new-nordic-food-scene` | 400x400 | image | Thumbnail: food scene. |
| 13 | `yoga-bible-DK/copenhagen/copenhagen-hygge-cafe-scene` | 400x400 | image | Thumbnail: hygge cafe. |
| 14 | `yoga-bible-DK/copenhagen/copenhagen-green-spaces-parks` | 400x400 | image | Thumbnail: parks/green spaces. |

### Journal Preview (3 dynamic images from featured posts)

| # | Source | Size | Description |
|---|--------|------|-------------|
| 15-17 | `journals.json → cloudinaryImage` or fallback OG | 1200x630 | 3 most recent featured posts. Currently ALL featured posts lack Cloudinary images. |

---

## 1B. Teacher Training Program Pages — Direct enrollment funnels

### OM200 Overview Page — [MISSING FROM media.json] — needs `om200` section

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 18 | `yoga-bible-DK/programs/om200/yogalaereruddannelse-200-timer-elev-anmeldelse` | 1920x1080 | VIDEO | Student testimonial video (poster + source) |
| 19 | `yoga-bible-DK/courses/workshop-previews.mp4` | 1920x1080 | VIDEO | Workshop preview reel |
| 20 | `yoga-bible-DK/brand/ya-logo-white.webp` | flexible | image | Yoga Alliance logo (white) |
| 21 | `yoga-bible-DK/brand/eryt500.png` | flexible | image | E-RYT 500 badge |
| 22 | `yoga-bible-DK/brand/rys200.png` | flexible | image | RYS 200 badge |
| 23 | `yoga-bible-DK/brand/yacep.png` | flexible | image | YACEP badge |

### 4-Week Intensive (P4W) — [IN media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 24 | `yoga-bible-DK/programs/p4w/yoga-alliance-ryt200-certificate-sample` | 1200x800 | image | Sample certificate |
| 25 | `yoga-bible-DK/programs/p4w/yogalaereruddannelse-elev-anmeldelse-4-uger` | 608x(vert) | VIDEO | Student testimonial |
| 26-29 | `yoga-bible-DK/YTT Programs/4w/studio-apartment-*`, `shared-apartment-*` | 800x600 | image | 4 accommodation photos |

### 8-Week Semi-Intensive (P8W) — [PARTIALLY MISSING FROM media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 30 | `yoga-bible-DK/programs/p8w/yoga-alliance-ryt200-certificate-sample` | 1200x800 | image | Certificate — [IN media.json] |
| 31-37 | Hardcoded `res.cloudinary.com` studio/location URLs | 800x600 | image | 7 studio images hardcoded in template (NOT in media.json) |
| 38-42 | Hardcoded accommodation images | 800x600 | image | 5 accommodation photos hardcoded |

### 18-Week Flexible (P18W) — [PARTIALLY MISSING FROM media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 43 | `yoga-bible-DK/programs/p18w/yogalaereruddannelse-elev-erfaring-koebenhavn` | 1280x(wide) | VIDEO | Hero student experience video |
| 44 | `yoga-bible-DK/programs/p18w/yogalaereruddannelse-18-uger-elev-anmeldelse` | 608x(vert) | VIDEO | Student testimonial |
| 45 | `yoga-bible-DK/programs/testimonial-weekday.mp4` | 1920x1080 | VIDEO | Weekday testimonial |
| 46-52 | Hardcoded `res.cloudinary.com` studio/location URLs | 800x600 | image | 7 studio/location images hardcoded in template |
| 53-54 | `yoga-bible-DK/courses/inversions-course.jpg`, `programs/ytt-200h-education.png` | various | image | Cross-promo cards |

### Shared Program Assets — [IN media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 55 | `yoga-bible-DK/programs/yoga-students-share-training-experience` | 1920x1080 | VIDEO | Group student testimonial |
| 56 | `yoga-bible-DK/programs/yoga-practice-session-loop` | 1920x1080 | VIDEO | Practice background loop |
| 57 | `yoga-bible-DK/programs/yoga-alliance-ryt200-certificate-sample` | 1200x800 | image | Generic certificate |

---

## 1C. Specialty Course Pages — Drive course purchases (2300 DKK each)

### Inversions Course — [IN media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 58 | `yoga-bible-DK/courses/inversions/inversions-yoga-course-hero` | 1920x900 | image | Page hero |
| 59 | `yoga-bible-DK/courses/inversions/inversions-video-poster-thumbnail` | 800x600 | image | Video poster |
| 60 | `yoga-bible-DK/courses/inversions/inversions-course-reel-subtitled` | 1920x1080 | VIDEO | Course reel with subtitles |
| 61 | `yoga-bible-DK/courses/inversions/inversions-course-full-demo` | 1920x1080 | VIDEO | Full demo video |
| 62 | `yoga-bible-DK/courses/inversions/anna-herceg-inversions-instructor` | 600x800 | image | Instructor portrait |
| 63-68 | `yoga-bible-DK/courses/inversions/inversions-gallery-*` | 600x400 | image | 6 gallery images (handstand, forearm, shoulder, headstand, spotter, group) |

**Also hardcoded in i18n (inversions.json):** — [MISSING FROM media.json]
| # | Cloudinary path | Type | Description |
|---|-----------------|------|-------------|
| 69 | `yoga-bible-DK/courses/inversions/inversions-hero-bg.mp4` | VIDEO | Hero background video |
| 70 | `yoga-bible-DK/courses/inversions/inversions-reel-sub.mp4` | VIDEO | Subtitled reel (alternate) |
| 71 | `yoga-bible-DK/courses/inversions/inversions-try-again.mov` | VIDEO | Try-again motivational clip |

### Splits Course — [ENTIRELY MISSING FROM media.json] — needs `splits` section

All paths hardcoded in `src/_data/i18n/splits.json`:

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 72 | `yoga-bible-DK/courses/splits-course` | 1920x900 | image | Hero image |
| 73 | `yoga-bible-DK/courses/splits/splits-standing-sita` | 800x600 | image | Video poster |
| 74 | `yoga-bible-DK/courses/splits/splits-reel.mp4` | 1920x1080 | VIDEO | Course reel |
| 75 | `yoga-bible-DK/courses/splits/sita-bio-splits` | 600x800 | image | Instructor portrait (Sita) |
| 76-81 | `yoga-bible-DK/courses/splits/splits-hip-open-01` through `-06` | 600x400 | image | 6 gallery images |

### Backbends Course — [ENTIRELY MISSING FROM media.json] — needs `backbends` section

All paths hardcoded in `src/_data/i18n/backbends.json`:

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 82 | `yoga-bible-DK/courses/backbend-training` | 1920x900 | image | Hero image |
| 83 | `yoga-bible-DK/courses/backbends/backbends-reel.mp4` | 1920x1080 | VIDEO | Course reel |
| 84-88 | `yoga-bible-DK/courses/backbend-training-pro` + gallery variants | 600x400 | image | Gallery images |

### Cross-Promotion Cards — [MISSING FROM media.json]

Used in `course-shared.json` for cross-selling between course pages:

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 89 | `yoga-bible-DK/courses/splits-course-cross` | 800x600 | image | Splits cross-promo card |
| 90 | `yoga-bible-DK/courses/backbend-cross` | 800x600 | image | Backbends cross-promo card |

---

## 1D. Checkout Flow Modal — Purchase conversion

The checkout modal (`modal-checkout-flow.njk`) uses product data from JS only — no image assets needed. The product badge uses text/CSS. No missing media here.

---

# PRIORITY 2 — BRAND & TRUST (Credibility & Social Sharing)

Missing these = poor social sharing previews, weak brand presence.

---

## 2A. Brand Assets — [IN media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 91 | `yoga-bible-DK/brand/yoga-bible-logo-orange` | flexible | image | Main logo |
| 92 | `yoga-bible-DK/brand/yoga-bible-logo-orange-2x` | flexible | image | 2x retina logo |
| 93 | `yoga-bible-DK/brand/yoga-bible-og-landscape` | 1200x630 | image | OG social share (landscape) |
| 94 | `yoga-bible-DK/brand/yoga-bible-og-square` | 1200x1200 | image | OG social share (square) |
| 95 | `yoga-bible-DK/brand/yoga-bible-footer-wordmark` | flexible | image | Footer wordmark |
| 96 | `yoga-bible-DK/brand/yoga-bible-app-store-badge` | flexible | image | App Store link badge |
| 97 | `yoga-bible-DK/brand/yoga-bible-google-play-badge` | flexible | image | Google Play link badge |
| 98 | `yoga-bible-DK/brand/instagram-glyph-gradient` | flexible | image | Instagram social icon |
| 99 | `yoga-bible-DK/brand/soundcloud-logo-white` | flexible | image | Soundcloud icon |

**Yoga Alliance Certification Badges — [MISSING FROM media.json brand section]:**

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 100 | `yoga-bible-DK/brand/ya-logo-white.webp` | flexible | image | Yoga Alliance logo (white, used on dark BG) |
| 101 | `yoga-bible-DK/brand/eryt500.png` | flexible | image | E-RYT 500 certification badge |
| 102 | `yoga-bible-DK/brand/rys200.png` | flexible | image | RYS 200 certification badge |
| 103 | `yoga-bible-DK/brand/yacep.png` | flexible | image | YACEP continuing education badge |

> These 4 badges appear on om200.njk and build trust for teacher training enrollment. Critical for credibility.

---

## 2B. Journal / Blog Featured Images — SEO & Social Sharing

**NONE of the 43 blog posts have a `cloudinaryImage` set.** All fall back to the generic OG image. This hurts:
- Social sharing previews (all posts look identical when shared)
- SEO (no unique images in search results)
- Click-through rates from social media

### Featured Posts (shown on homepage — highest priority):

| Slug | Cloudinary path needed | Status |
|------|----------------------|--------|
| `fra-kontorstol-til-yogamaatte` | `yoga-bible-DK/journal/fra-kontorstol-til-yogamaatte` | NO CLOUD |
| `yogalaerer-i-koebenhavn-karriere` | `yoga-bible-DK/journal/yogalaerer-i-koebenhavn-karriere` | NO CLOUD |
| `yin-yoga-den-stille-kraft` | `yoga-bible-DK/journal/yin-yoga-den-stille-kraft` | NO CLOUD |
| `18-ugers-yogalaereruddannelse-fleksibelt-program` | `yoga-bible-DK/journal/18-ugers-yogalaereruddannelse-fleksibelt-program` | NO CLOUD |
| `hvad-er-vinyasa-yoga` | `yoga-bible-DK/journal/hvad-er-vinyasa-yoga` | NO CLOUD |
| `5-aandedraetsteknikker-for-begyndere` | `yoga-bible-DK/journal/5-aandedraetsteknikker-for-begyndere` | NO CLOUD |
| `yoga-og-mental-sundhed` | `yoga-bible-DK/journal/yoga-og-mental-sundhed` | NO CLOUD |

### Non-Featured Posts (still shared on social — lower priority):

All 36 remaining posts also need unique 1200x630 images. Full slug list:

`de-syv-chakraer-forklaret`, `guide-til-din-foerste-yogalaereruddannelse`, `fordelene-ved-hot-yoga`, `din-foerste-inversion-guide`, `arm-balances-modet-til-at-falde`, `sikker-hovedstand-teknik`, `splits-fleksibilitet-guide`, `hoftefleksibilitet-kontorarbejdere`, `aktiv-vs-passiv-fleksibilitet`, `backbends-uden-smerter`, `rygsojlens-anatomi-yogaudovere`, `fra-bro-til-wheel-guide`, `hvad-er-ashtanga-yoga`, `restorative-yoga-guide`, `yoga-nidra-bevidst-soevn`, `hatha-yoga-alle-stilarters-moder`, `vibro-yoga-fremtidens-praksis`, `wim-hof-vs-pranayama`, `pranayama-og-nervesystemet`, `avanceret-pranayama-kumbhaka`, `morgen-aandedraetsteknik-5-minutter`, `yamas-og-niyamas-yogaens-etik`, `yoga-sutras-for-moderne-mennesker`, `ayurveda-og-yoga-din-dosha-type`, `meditation-for-dem-der-ikke-kan-sidde-stille`, `karma-dharma-og-dit-yogaliv`, `yoga-og-soevn-bedre-naetter`, `yoga-for-loebere-og-atleter`, `infrared-varme-og-din-krop`, `yoga-mod-stress-og-angst`, `yoga-efter-graviditet-postnatal`, `digital-detox-med-yoga`, `hvad-laerer-du-i-200-timers-yogauddannelse`, `300-timers-uddannelse-naeste-skridt`, `5-fejl-nye-yogalaerere-begaar`, `cueing-kunsten-at-guide-med-stemmen`, `yoga-som-bijob-eller-fuldtid`

> Upload each as `yoga-bible-DK/journal/{slug}` at **1200x630**.

---

# PRIORITY 3 — STUDENT EXPERIENCE (Decision-Making Pages)

These pages help prospective students decide. Missing media = weaker conversion.

---

## 3A. Accommodation Page — [PARTIALLY IN media.json, many hardcoded]

### Videos — [MISSING FROM media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 104 | `yoga-bible-DK/accommodation/accommodation-hero-loop` | 1920x1080 | VIDEO | Hero background loop |
| 105 | `yoga-bible-DK/accommodation/student-apartment-living-copenhagen` | 600x(vert) | VIDEO | Apartment living loop |
| 106 | `yoga-bible-DK/accommodation/yoga-student-cooking-copenhagen-kitchen` | 600x(vert) | VIDEO | Kitchen/cooking loop |
| 107 | `yoga-bible-DK/accommodation/christianshavn-copenhagen-neighbourhood` | 1280x720 | VIDEO | Neighborhood walkthrough |

### Apartment Images — [IN media.json]

| # | Type | Count | Description |
|---|------|-------|-------------|
| 108-112 | Single studio | 5 | Overview, bedroom, kitchen, bathroom, workspace |
| 113-117 | Shared apartment | 5 | Bedroom, private room, common area, bathroom-kitchen, living space |

### Hotels & Hostels — [IN media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 118 | `yoga-bible-DK/accommodation/hotel-cph-living-floating-copenhagen` | 800x600 | image | CPH Living floating hotel |
| 119 | `yoga-bible-DK/accommodation/hotel-25hours-paper-island-copenhagen` | 800x600 | image | 25hours Paper Island |
| 120 | `yoga-bible-DK/accommodation/hostel-generator-copenhagen` | 800x600 | image | Generator Hostel |
| 121 | `yoga-bible-DK/accommodation/hostel-steel-house-copenhagen` | 800x600 | image | Steel House Hostel |

### Hardcoded Images in Template — [MISSING FROM media.json]

The accommodation template has ~12 images referenced as full `res.cloudinary.com` URLs instead of via media.json:
- `single-apartment-hero.jpg`, `single-apartment-01.jpg` through `-04.jpg`
- `double-bedroom-01.jpg` through `-07.jpg` (selected)
- Various carousel images with `v-param` style IDs

### Course Cards — [IN media.json as `accommodationCourseCards`]

| # | Cloudinary path | Size | Description |
|---|-----------------|------|-------------|
| 122 | `yoga-bible-DK/accommodation/course-4-week-intensive-yoga-training` | 1200x630 | 4-week card |
| 123 | `yoga-bible-DK/accommodation/course-8-week-semi-intensive-yoga` | 1200x630 | 8-week card |
| 124 | `yoga-bible-DK/accommodation/course-bundles-yoga-specialty-training` | 1200x630 | Bundles card |

---

## 3B. Copenhagen Page — [IN media.json]

### Hero & Location Videos

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 125 | `yoga-bible-DK/copenhagen/about-copenhagen-hero-loop` | 1920x1080 | VIDEO | Page hero loop — [MISSING FROM media.json] |
| 126 | `yoga-bible-DK/copenhagen/christianshavn-neighborhood-walkthrough` | 1280x720 | VIDEO | Neighborhood video — [IN media.json] |

### Lifestyle Grid (8 images) — [IN media.json]

Bike culture, hygge cafe, saunagus, cold water, concerts, design, green spaces, food scene — all 400-800px.

### Why Copenhagen Section (5 images) — [IN media.json]

Studio interior, historic building detail, airport terminal, flights map, hygge candles.

### Explore/Attractions (7 images) — [IN media.json]

Nyhavn, Christiania, Louisiana Museum, Tivoli, Harbor bath, Oresund Bridge, Kings Garden.

---

## 3C. Studio & Location — [IN media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 127 | `yoga-bible-DK/studio/yoga-bible-studio-hot-room-copenhagen` | 800x600 | image | Hot room |
| 128 | `yoga-bible-DK/studio/yoga-bible-training-room-daylight` | 800x600 | image | Training room |
| 129 | `yoga-bible-DK/studio/yoga-bible-studio-torvegade-66-entrance` | 800x600 | image | Entrance |
| 130 | `yoga-bible-DK/studio/yoga-bible-shower-changing-facilities` | 800x600 | image | Shower/changing |
| 131 | `yoga-bible-DK/studio/yoga-bible-main-practice-room` | 800x600 | image | Main room |
| 132 | `yoga-bible-DK/studio/yoga-bible-studio-panorama-torvegade` | 1920x900 | image | Wide panorama |

### Contact Page Studio Image — [MISSING FROM media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 133 | `yoga-bible-DK/studio/dsc-8528.jpg` | 800x600 | image | Studio poster (hardcoded in kontakt.json) |
| 134 | `yoga-bible-DK/careers/careers-vertical.mp4` | 1080x1920 | VIDEO | Hero video on contact page (hardcoded in kontakt.json) |

---

## 3D. Compare Page (Teacher Profiles) — [IN media.json]

| # | Cloudinary path | Size | Description |
|---|-----------------|------|-------------|
| 135 | `yoga-bible-DK/compare/teacher-profile-lifelong-learner` | 600x800 | Lifelong learner avatar |
| 136 | `yoga-bible-DK/compare/teacher-profile-midcareer-changer` | 600x800 | Mid-career changer |
| 137 | `yoga-bible-DK/compare/teacher-profile-rising-teacher` | 600x800 | Rising teacher |

---

# PRIORITY 4 — BRAND CONCEPTS (Hot Yoga, Namasté, Vibro)

These pages build brand identity and drive class memberships.

---

## 4A. Hot Yoga Copenhagen — [IN media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 138 | `yoga-bible-DK/concepts/hotyoga/hot-yoga-copenhagen-studio-session` | 1920x900 | image | Hero |
| 139 | `yoga-bible-DK/concepts/hotyoga/infrared-heating-yoga-studio` | 900x650 | image | Feature: infrared |
| 140-143 | `yoga-bible-DK/concepts/hotyoga/ginger-shots-*`, `premium-*`, `curated-*` | 600x340 | image | Feature cards |
| 144-146 | `yoga-bible-DK/concepts/hotyoga/sonic-shavasana-*`, `frozen-towel-*`, `herbal-tea-*` | 600x340 | VIDEO | Feature card videos |
| 147 | `yoga-bible-DK/concepts/hotyoga/hot-yoga-copenhagen-promo` | 1920x1080 | VIDEO | Promo video |

> Also has external direct IDs (`v1772433753/...`) for Hot Yoga CPH branding — these bypass media.json.

## 4B. Namasté Online — [IN media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 148 | `yoga-bible-DK/concepts/namaste/namaste-online-yoga-streaming-hero` | 1920x900 | image | Hero |
| 149-151 | `yoga-bible-DK/concepts/namaste/live-online-*`, `yoga-teacher-*`, `at-home-*` | 600x400 | image | Class scenes |
| 152 | `yoga-bible-DK/concepts/namaste/namaste-online-platform-demo` | 1920x1080 | VIDEO | Platform demo |

## 4C. Vibro Yoga — [IN media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 153 | `yoga-bible-DK/concepts/vibro/vibro-yoga-vibration-platform-hero` | 1920x900 | image | Hero |
| 154-156 | `yoga-bible-DK/concepts/vibro/vibro-yoga-studio-*`, `vibro-yin-*`, `vibration-shower-*` | 600x400 | image | Feature images |
| 157 | `yoga-bible-DK/concepts/vibro/vibro-yoga-concept-demo` | 1920x1080 | VIDEO | Concept demo |

---

# PRIORITY 5 — CONTENT & LIFESTYLE PAGES

Lower urgency but still part of the complete site experience.

---

## 5A. Yoga Music Page — [ENTIRELY MISSING FROM media.json] — needs `yogamusic` section

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 158 | `yoga-bible-DK/yogamusic/hero-poster` | 1920x1080 | image | Hero poster |
| 159 | `yoga-bible-DK/yogamusic/hero-loop` | 1920x1080 | VIDEO | Hero background loop |
| 160 | `yoga-bible-DK/yogamusic/quote-poster` | 800x1000 | image | Quote section poster |
| 161 | `yoga-bible-DK/yogamusic/quote-loop` | 800x1000 | VIDEO | Quote section loop |
| 162 | `yoga-bible-DK/yogamusic/phone-poster` | 680x1210 | image | Phone mockup poster |
| 163 | `yoga-bible-DK/yogamusic/phone-loop` | 680x1210 | VIDEO | Phone mockup loop |

## 5B. Yoga Photography Page — [ENTIRELY MISSING FROM media.json] — needs `yogaphotography` section

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 164 | `yoga-bible-DK/yogaphotography/session-hero` | 1920x(tall) | image | Dark cinematic hero |
| 165 | `yoga-bible-DK/yogaphotography/quote-hero` | 1400x(tall) | image | Quote section hero |
| 166-168 | `yoga-bible-DK/yogaphotography/interstitial-1`, `-2`, `-3` | 1200x1600 | image | Vertical divider images |
| 169+ | `yoga-bible-DK/yogaphotography/models/{name}` | 520px wide | image | Model portraits (dynamic) |
| 170+ | `yoga-bible-DK/yogaphotography/models/{name}-gallery-*` | 600-800px | image | Model gallery photos |

## 5C. Careers Page — [IN media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 171 | `yoga-bible-DK/careers/yoga-teaching-careers-hero-poster` | 1080x1440 | image | Hero poster |
| 172 | `yoga-bible-DK/careers/yoga-careers-hero-vertical` | 1080x1920 | VIDEO | Vertical hero video |

## 5D. Apply Page — [IN media.json]

| # | Cloudinary path | Size | Description |
|---|-----------------|------|-------------|
| 173 | `yoga-bible-DK/apply/beth-yoga-instructor-portrait` | 800x1000 | Instructor portrait |

## 5E. Mentorship Page — [IN media.json]

| # | Cloudinary path | Size | Description |
|---|-----------------|------|-------------|
| 174 | `yoga-bible-DK/mentorship/private-mentorship-inversions-session` | 1200x800 | Hero image |
| 175 | `yoga-bible-DK/mentorship/mentorship-practice-video-poster` | 1200x800 | Video poster |

## 5F. Link Page — [IN media.json]

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 176 | `yoga-bible-DK/link/yoga-bible-link-hero-poster` | 1080x1440 | image | Hero poster |
| 177 | `yoga-bible-DK/link/yoga-bible-link-hero-vertical` | 1080x1920 | VIDEO | Vertical hero |

## 5G. Schedule Pages — [ENTIRELY MISSING FROM media.json] — needs `schedulePages` section

Placeholder comments exist in templates but no assets referenced yet:

| # | Cloudinary path | Size | Type | Description |
|---|-----------------|------|------|-------------|
| 178 | `yoga-bible-DK/schedule/yoga-practice-hero-loop` | 1920x1080 | VIDEO | Shared schedule hero — [IN media.json] |
| 179 | `yoga-bible-DK/schedule/yoga-bible-app-demo-mobile` | 1080x1920 | VIDEO | App demo — [IN media.json] |
| 180 | `yoga-bible-DK/schedule-pages/4w/hero` | 1920x900 | image | 4-week schedule hero — PLACEHOLDER |
| 181 | `yoga-bible-DK/schedule-pages/4w/og` | 1200x630 | image | 4-week OG image — PLACEHOLDER |
| 182 | `yoga-bible-DK/schedule-pages/8w/hero` | 1920x900 | image | 8-week schedule hero — PLACEHOLDER |
| 183 | `yoga-bible-DK/schedule-pages/8w/og` | 1200x630 | image | 8-week OG image — PLACEHOLDER |
| 184 | `yoga-bible-DK/schedule-pages/18w/hero` | 1920x900 | image | 18-week schedule hero — PLACEHOLDER |
| 185 | `yoga-bible-DK/schedule-pages/18w/og` | 1200x630 | image | 18-week OG image — PLACEHOLDER |
| 186 | `yoga-bible-DK/schedule-pages/4w-jul/hero` | 1920x900 | image | July 4-week hero — PLACEHOLDER |
| 187 | `yoga-bible-DK/schedule-pages/4w-jul/og` | 1200x630 | image | July 4-week OG — PLACEHOLDER |

## 5H. Member Area — [IN media.json]

| # | Cloudinary path | Size | Description |
|---|-----------------|------|-------------|
| 188 | `yoga-bible-DK/member/yoga-registration-hero` | 1200x800 | Registration modal hero |

---

# PRIORITY 6 — LOCAL FILES TO MIGRATE

These files exist locally but should be on Cloudinary for consistency and CDN delivery.

| # | Local path | Suggested Cloudinary path | Notes |
|---|-----------|--------------------------|-------|
| L1 | `src/assets/images/brand/logo-orange-on-transparent.png` | Already on Cloudinary as `yoga-bible-DK/brand/yoga-bible-logo-orange` | Used in header.njk, modal-auth.njk — consider switching to Cloudinary URL |
| L2 | `src/assets/images/brand/logo-orange-on-transparent-2x.png` | Already on Cloudinary as `yoga-bible-DK/brand/yoga-bible-logo-orange-2x` | Retina variant |
| L3 | `src/assets/images/concepts/namaste-online-logo.png` | `yoga-bible-DK/concepts/namaste/namaste-online-logo` | Local fallback for Namasté |
| L4 | `src/assets/images/concepts/namaste-studios-logo.png` | `yoga-bible-DK/concepts/namaste/namaste-studios-logo` | Local fallback |
| L5 | `assets/images/og/og-1200x630.png` | `yoga-bible-DK/brand/yoga-bible-og-landscape` | Default OG — keep local as fallback |
| L6 | `assets/images/member/register-hero.jpg` | `yoga-bible-DK/member/yoga-registration-hero` | Should use Cloudinary version |
| L7-L9 | `assets/images/compare/teacher-profile-*.jpg` (3 files) | Already on Cloudinary as `yoga-bible-DK/compare/teacher-profile-*` | Should switch to Cloudinary URLs |
| L10+ | `src/assets/images/journal/*.svg` (~40 SVG placeholders) | Keep local | Lightweight fallbacks, OK to leave |

---

# SUMMARY

## Totals by Status

| Status | Images | Videos | Total |
|--------|--------|--------|-------|
| **In media.json (properly centralized)** | ~85 | ~10 | ~95 |
| **Hardcoded in templates (should be in media.json)** | ~25 | ~8 | ~33 |
| **Entirely missing from media.json (new sections needed)** | ~20 | ~8 | ~28 |
| **Blog posts with no Cloudinary image** | 43 | 0 | 43 |
| **Schedule page placeholders (not yet implemented)** | 8 | 0 | 8 |
| **Local files to potentially migrate** | ~10 | 0 | ~10 |

## media.json Sections That Need Adding

| Section | What's missing | Priority |
|---------|---------------|----------|
| `brand` (extend) | `yaLogoWhite`, `eryt500`, `rys200`, `yacep` | P1 — Trust badges |
| `om200` | Entire page (testimonial video, workshop video) | P1 — Enrollment |
| `splits` | Entire course (hero, video, instructor, 6 gallery) | P1 — Course sales |
| `backbends` | Entire course (hero, video, gallery) | P1 — Course sales |
| `courseCross` | Cross-promotion cards (splits-cross, backbend-cross) | P1 — Upselling |
| `yogamusic` | Entire page (3 poster + 3 video pairs) | P5 — Content |
| `yogaphotography` | Entire page (hero, interstitials, model data) | P5 — Content |
| `schedulePages` | Hero + OG for 4 schedule variants | P5 — Content |
| `kontakt` | Studio poster, careers video | P3 — Contact |

## Top Actions by Business Impact

1. **Upload 7 featured blog images** — Immediately improves social sharing for homepage-visible posts
2. **Add Yoga Alliance badges to brand/media.json** — Trust signals on enrollment pages
3. **Add splits + backbends to media.json** — These are revenue pages with zero media centralization
4. **Add accommodation videos to media.json** — 4 videos hardcoded, should be centralized
5. **Add yogamusic + yogaphotography to media.json** — Full pages with no media.json coverage
6. **Clean up p8w/p18w hardcoded URLs** — These program pages have 12+ images as raw Cloudinary URLs
7. **Upload remaining 36 blog images** — Long-tail SEO improvement

---

## Image Guidelines

- **Dark overlay images** (fork, triptych, CPH): subjects visible at 40-60% opacity overlay
- **Portrait crops** (triptych, models): 800x900 minimum, vertical, subject centered
- **Thumbnails** (CPH highlights): Upload 400x400+, Cloudinary auto-crops to 120x120 `c_fill`
- **Videos**: MP4/H.264, under 10MB, no audio (muted autoplay)
- **Blog images**: 1200x630 (OG-compatible), JPG/PNG, Cloudinary auto-converts to WebP
- **All formats**: Upload as JPG or PNG. Cloudinary auto-converts via `f_auto`
