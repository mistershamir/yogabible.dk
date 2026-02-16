# Homepage Media Checklist

**Cloud:** `ddcynsa30` | **Root folder:** `yoga-bible-DK/`
**Upload URL:** https://console.cloudinary.com/app/ddcynsa30/media_library

Every media reference on the homepage (`src/_includes/pages/index.njk`) is listed below, grouped by section.
Upload each file to the matching Cloudinary path. Naming convention: lowercase, hyphens, no extension needed.

---

## Summary

| Type | Count |
|------|-------|
| **Images** | 12 |
| **Videos** | 2 |
| **Journal images** | 3 (dynamic, from featured posts) |
| **Total** | **17** |

---

## Section 1 — Hero (1 image + 1 video)

| # | Cloudinary key | Upload as | Size | Type | Description |
|---|----------------|-----------|------|------|-------------|
| 1 | `media.homepage.studioPanorama` | `yoga-bible-DK/homepage/studio-panorama` | 1920x1080 | image | Static poster/fallback for hero video. Also used as studio section poster. Dark, cinematic studio interior. |
| 2 | `media.homepage.heroVideo` | `yoga-bible-DK/homepage/hero-loop` | 1920x1080 | VIDEO | Auto-playing hero background loop. Silent, dark-toned yoga practice footage. 10-20s loop. |

---

## Section 3 — The Fork (2 images)

| # | Cloudinary key | Upload as | Size | Type | Description |
|---|----------------|-----------|------|------|-------------|
| 3 | `media.courses.education200hr` | `yoga-bible-DK/courses/200-hour-yoga-education-copenhagen` | 1200x800 | image | Left panel: "Become a Yoga Teacher." Teacher + students in training. Cinematic feel, works under dark gradient overlay. |
| 4 | `media.courses.inversionsPromo` | `yoga-bible-DK/courses/inversions-course-copenhagen-promo` | 1200x800 | image | Right panel: "Deepen Your Practice." Dynamic yoga pose (inversion/arm balance). Works under dark gradient overlay. |

---

## Section 6 — Specialty Courses Triptych (3 images)

| # | Cloudinary key | Upload as | Size | Type | Description |
|---|----------------|-----------|------|------|-------------|
| 5 | `media.homepage.inversionsCard` | `yoga-bible-DK/homepage/inversions-card` | 800x900 | image | Portrait crop. Handstand or arm balance. Works under bottom-up dark gradient. Text overlays at bottom. |
| 6 | `media.homepage.splitsCard` | `yoga-bible-DK/homepage/splits-card` | 800x900 | image | Portrait crop. Front or middle split. Works under bottom-up dark gradient. Text overlays at bottom. |
| 7 | `media.homepage.backbendsCard` | `yoga-bible-DK/homepage/backbends-card` | 800x900 | image | Portrait crop. Wheel pose or deep backbend. Works under bottom-up dark gradient. Text overlays at bottom. |

---

## Section 7 — Studio & Community (1 video, reuses image #1)

| # | Cloudinary key | Upload as | Size | Type | Description |
|---|----------------|-----------|------|------|-------------|
| 8 | `media.programs.practiceLoopVideo` | `yoga-bible-DK/programs/practice-loop` | 1920x1080 | VIDEO | Silent yoga class in progress. Background loop, 10-20s. Dark overlay will cover ~60% — doesn't need to be sharp. |
| — | `media.homepage.studioPanorama` | *(reuses #1)* | — | — | Same poster image as hero, used as video fallback. |

---

## Section 10 — Copenhagen Cinema (6 images, 1 reused)

Background image (full-bleed):

| # | Cloudinary key | Upload as | Size | Type | Description |
|---|----------------|-----------|------|------|-------------|
| 9 | `media.copenhagen.canalPanorama` | `yoga-bible-DK/copenhagen/canal-panorama` | 1920x1080 | image | Christianshavn canal panorama. Wide, cinematic. Also used as thumbnail for "Kanaler & Arkitektur" highlight (auto-cropped to 120x120). |

Highlight thumbnails (52x52 display, uploaded larger for quality):

| # | Cloudinary key | Upload as | Min size | Description |
|---|----------------|-----------|----------|-------------|
| 10 | `media.copenhagen.bikeCulture` | `yoga-bible-DK/copenhagen/bike-culture` | 400x400 | Cyclists on Copenhagen streets. Served at 120x120, upload square or will be auto-cropped. |
| 11 | `media.copenhagen.saunagus` | `yoga-bible-DK/copenhagen/saunagus` | 400x400 | Danish sauna / cold water culture. Winter swimming or saunagus ritual. |
| 12 | `media.copenhagen.foodScene` | `yoga-bible-DK/copenhagen/food-scene` | 400x400 | New Nordic food — plated dish, street food, or market scene. |
| 13 | `media.copenhagen.cafeScene` | `yoga-bible-DK/copenhagen/cafe-scene` | 400x400 | Hygge cafe — specialty coffee, ceramic cups, warm light. |
| 14 | `media.copenhagen.greenSpaces` | `yoga-bible-DK/copenhagen/green-spaces` | 400x400 | Parks, harbour baths, botanical gardens, green spaces. |

---

## Section 11 — Journal Preview (up to 3 images, dynamic)

Journal images come from `src/_data/journals.json` entries where `featured: true`. The 3 most recent featured posts are shown.

| # | Cloudinary key | Upload as | Size | Description |
|---|----------------|-----------|------|-------------|
| 15 | `entry.cloudinaryImage` | `yoga-bible-DK/journal/{slug}` | 1200x630 | Featured image per blog post. Each post needs its own image named after the slug. |
| 16 | *(2nd featured post)* | `yoga-bible-DK/journal/{slug}` | 1200x630 | Same pattern. |
| 17 | *(3rd featured post)* | `yoga-bible-DK/journal/{slug}` | 1200x630 | Same pattern. |

Current featured posts (check `journals.json` for latest):
- `fordelene-ved-hot-yoga`
- `guide-til-din-foerste-yogalaereruddannelse`
- `yoga-og-mental-sundhed`

---

## Sections with NO media

These homepage sections are text/CSS only — no images or videos needed:

| Section | Name | Why no media |
|---------|------|--------------|
| 4 | Training Programs | Pure typography (large numbers 4/8/18) |
| 5 | Dark Cinematic Quote | Text + CSS glow effect |
| 8 | Testimonials | Text cards, stars, no avatars |
| 9 | Why Us | Frosted glass cards, CSS watermarks |
| 12 | Final CTA | Text + gradient background |

---

## Priority Upload Order

1. **Hero video + poster** (#1, #2) — first thing visitors see
2. **Fork images** (#3, #4) — immediately below hero
3. **Triptych course images** (#5, #6, #7) — course showcase
4. **Studio loop video** (#8) — community section
5. **Copenhagen images** (#9–#14) — lifestyle showcase
6. **Journal images** (#15–#17) — blog preview cards

---

## Image Guidelines

- **Dark overlay images** (fork, triptych, CPH): subjects should be visible at 40-60% opacity overlay. Avoid bright whites or text in the image itself.
- **Portrait crops** (triptych): 800x900 minimum. Vertical composition, subject centered or slightly off-center.
- **Thumbnails** (CPH highlights): Upload at least 400x400. Cloudinary auto-crops to 120x120 `c_fill`.
- **Videos**: MP4 format, H.264 codec. Keep under 10MB for fast loading. No audio needed (muted autoplay).
- **All formats**: Cloudinary auto-converts to WebP/AVIF via `f_auto`. Upload as JPG or PNG.
