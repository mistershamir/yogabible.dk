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

## Architecture Reference

- **Framework:** Eleventy v3.1.2, Nunjucks templates
- **Data:** `src/_data/journals.json` (wrapped: `{"entries": [...]}`)
- **Listing:** `src/yoga-journal.njk` → `/yoga-journal/`
- **Posts:** `src/yoga-journal-post.njk` (Eleventy pagination, size:1)
- **JS:** `src/js/journal.js` — language switching, search, progress bar, share
- **CSS:** `src/css/main.css` — all journal styles prefixed `yj-`, all store/profile styles prefixed `yb-store__`
- **CMS:** Decap CMS at `/admin/` with Netlify Identity
- **i18n:** Build-time via JSON files in `src/_data/i18n/`, path-based (`/en/` prefix). Journal uses `data-yj-da`/`data-yj-en` attributes toggled by path detection.
- **Deploy:** Netlify from `main` branch
- **Design System:** `src/samples.njk` → `/samples/` — the single source of truth for all UI components
- **Profile/Store:** `src/js/profile.js` — user profile, store catalog, checkout, waiver, schedule, membership
- **Hot Yoga CPH:** `hot-yoga-cph/public/js/profile.js` + `hot-yoga-cph/public/css/profile.css` — mirrored store/profile for HYC site

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
- **Back navigation:** Register step has "Tilbage" → login. Checkout step has "Tilbage" → whichever auth step the user came from (`authOriginStep` state). Hidden when user was already logged in.
- **ytt-funnel.js auth listener** checks if `ycf-modal` is open before redirecting — prevents conflict between the two systems
- **Step indicator:** 3 dots connected by lines, progressively filled orange as user advances

#### Product Catalog

The `PRODUCTS` object in `checkout-flow.js` contains all CTA-purchasable items with: `price`, `name_da/en`, `period_da/en`, `format_da/en`, `desc_da/en`, `category`. **This must be kept in sync with `storeCatalog` in `profile.js`** when products are added/changed.

Current products:
- **Teacher Training (5):** 100078, 100121, 100211, 100209, 100210 — all 3750 DKK
- **Courses (3):** 100145, 100150, 100140 — all 2300 DKK

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
