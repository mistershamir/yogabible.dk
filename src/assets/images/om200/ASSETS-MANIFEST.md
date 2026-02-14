# OM200 Page — Image & Video Asset Manifest

All assets for the 200-Hour Yoga Teacher Training page.
Drop files here with the exact names below for automatic integration.

---

## Teacher Portraits (400 × 500 px · Portrait · 4:5 ratio)

| File Name | Subject | Format | Max Size |
|-----------|---------|--------|----------|
| `mister-shamir-yoga-teacher-training.webp` | Mister Shamir – Lead Teacher | WebP | 80 KB |
| `anna-herceg-yoga-teacher-training.webp` | Anna Herceg – Lead Trainer | WebP | 80 KB |
| `charlotte-nielsen-yoga-anatomy-teacher.webp` | Charlotte Nielsen – Anatomy | WebP | 80 KB |
| `eva-fink-yoga-philosophy-yin-teacher.webp` | Eva Fink – Philosophy & Yin | WebP | 80 KB |

**Tips:** Crop to 4:5 ratio, center on face/upper body. Solid or studio background preferred. Consistent lighting across all four.

---

## Hero Carousel (1200 × 800 px · Landscape · 3:2 ratio)

| File Name | Subject | Format | Max Size |
|-----------|---------|--------|----------|
| `200-hour-yoga-teacher-training-copenhagen-1.webp` | Training group/workshop scene | WebP | 120 KB |
| `200-hour-yoga-teacher-training-copenhagen-2.webp` | Teaching/alignment moment | WebP | 120 KB |
| `200-hour-yoga-teacher-training-copenhagen-3.webp` | Group practice/flow | WebP | 120 KB |
| `200-hour-yoga-teacher-training-copenhagen-4.webp` | Graduation/certificate moment | WebP | 120 KB |

---

## Location / Studio Gallery (1200 × 675 px · Landscape · 16:9 ratio)

| File Name | Subject | Format | Max Size |
|-----------|---------|--------|----------|
| `yoga-studio-christianshavn-copenhagen-1.webp` | Main yoga room overview | WebP | 100 KB |
| `yoga-studio-christianshavn-copenhagen-2.webp` | Workshop setup / props | WebP | 100 KB |
| `yoga-studio-christianshavn-copenhagen-3.webp` | Streaming setup / camera view | WebP | 100 KB |
| `yoga-studio-christianshavn-copenhagen-4.webp` | Changing rooms / facilities | WebP | 100 KB |

---

## Credentials / Presentation Video

| File Name | Subject | Format | Max Size |
|-----------|---------|--------|----------|
| `yoga-bible-200hr-ytt-presentation.mp4` | YTT overview/promotional video | MP4 (H.264) | 15 MB |

**Currently using:** Google Drive embed (ID: `1WWanYni0tZKJ656czw_N2Vf6thCKFwU8`)

---

## Online Workshop Preview Video

| File Name | Subject | Format | Max Size |
|-----------|---------|--------|----------|
| `yoga-bible-online-workshop-preview.mp4` | Online camera angle preview | MP4 (H.264) | 10 MB |

**Currently using:** `https://www.yogabible.dk/s/Yoga-Bible-Workshop-Previews.mp4`

---

## SEO & AEO File Naming Rules

1. **Lowercase, hyphenated:** `yoga-teacher-training-copenhagen.webp`
2. **Include keywords:** city, topic, brand where relevant
3. **WebP format** preferred for images (40-60% smaller than JPEG)
4. **Alt text** is set via i18n JSON — update `teachers_img_alt` keys when images are added
5. **Lazy loading** applied automatically for all images except hero slide 1

---

## Integration Steps

1. Drop files in this folder (`src/assets/images/om200/`)
2. Update `src/_includes/pages/om200.njk` — replace `<div class="om2-teachers__placeholder">` blocks with `<img>` tags
3. Update `src/js/om200.js` — replace IMAGES array URLs with local paths
4. Build: `npx @11ty/eleventy`
