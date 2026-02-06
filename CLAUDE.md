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

## Architecture Reference

- **Framework:** Eleventy v3.1.2, Nunjucks templates
- **Data:** `src/_data/journals.json` (wrapped: `{"entries": [...]}`)
- **Listing:** `src/yoga-journal.njk` → `/yoga-journal/`
- **Posts:** `src/yoga-journal-post.njk` (Eleventy pagination, size:1)
- **JS:** `src/js/journal.js` — language switching, search, progress bar, share
- **CSS:** `src/css/main.css` — all journal styles prefixed `yj-`
- **CMS:** Decap CMS at `/admin/` with Netlify Identity
- **i18n:** Hostname-based (www=DA, en=EN), per-post `data-yj-da`/`data-yj-en` toggle
- **Deploy:** Netlify from `main` branch
- **Design System:** `src/samples.njk` → `/samples/` — the single source of truth for all UI components

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
