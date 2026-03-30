# Framer SEO Checklist — Page by Page

Use this checklist to audit and optimize every page on hotyogacph.dk in Framer.

---

## Global Settings (Framer → Site Settings)

- [ ] **Favicon:** Custom branded favicon (not emoji)
- [ ] **Default OG Image:** 1200x630px branded image
- [ ] **Google Search Console:** Verify ownership via meta tag or DNS
- [ ] **Google Analytics:** Add GA4 tracking code
- [ ] **Custom domain:** Ensure www redirect works (www.hotyogacph.dk → hotyogacph.dk or vice versa)
- [ ] **SSL:** HTTPS enabled (Framer does this by default)
- [ ] **Sitemap:** Verify at hotyogacph.dk/sitemap.xml

**DO NOT add JSON-LD schema to global settings — it must go on individual pages.**

---

## Homepage (hotyogacph.dk)

### Meta Tags (Page Settings → SEO)
- [ ] **Title:** `Hot Yoga Copenhagen — Infrared Yoga Studio i Christianshavn` (under 60 chars)
- [ ] **Description:** `Premium infraret hot yoga studio i Christianshavn siden 2014. 30+ ugentlige klasser, alle niveauer. Prøv fra 299 kr. ★ 4.9/5 fra 500+ anmeldelser.` (under 160 chars)
- [ ] **OG Title:** Same as title or `Hot Yoga Copenhagen — Bedste Hot Yoga i København`
- [ ] **OG Description:** Same as meta description
- [ ] **OG Image:** Studio hero shot, 1200x630px

### Structured Data (Page Settings → Custom Code → Start of `<head>`)
- [ ] Add `schema-homepage.json` (LocalBusiness + WebSite + AggregateRating)

### Content
- [ ] H1: One clear H1 (e.g., "Hot Yoga Copenhagen" or "Premium Infrared Hot Yoga in Christianshavn")
- [ ] Minimum 500 words of text content on page
- [ ] Include class types overview with descriptions
- [ ] Include pricing teaser with link to pricing page
- [ ] Include location/address with map or directions
- [ ] Include trust signals (years in business, review count, Yoga Alliance badge)
- [ ] Internal links to: /book-a-class, /yoga-pricing-1, /teacher-training, /faq

### Images
- [ ] All images have descriptive alt text
- [ ] Hero image alt: "Hot yoga class in infrared heated studio at Hot Yoga Copenhagen"
- [ ] Images optimized (WebP, lazy-loaded — Framer does this automatically)

---

## Book a Class (hotyogacph.dk/book-a-class)

### Meta Tags
- [ ] **Title:** `Book en Hot Yoga Klasse — Hot Yoga Copenhagen` (DA) / `Book a Hot Yoga Class — Hot Yoga Copenhagen` (EN)
- [ ] **Description:** `Book din næste hot yoga klasse i København. Vinyasa, Yin, Power, Sculpt og mere. Alle niveauer velkomne. Drop-in fra 299 kr.`

### Structured Data
- [ ] Add `schema-classes.json` (ExercisePlan types + BreadcrumbList)

### Content
- [ ] Description of each class type (150+ words each)
- [ ] Who each class is suitable for
- [ ] Difficulty level per class
- [ ] What to expect in your first class
- [ ] Link to pricing page

---

## Pricing (hotyogacph.dk/yoga-pricing-1)

### Meta Tags
- [ ] **Title:** `Priser & Medlemskab — Hot Yoga Copenhagen` / `Pricing & Membership — Hot Yoga Copenhagen`
- [ ] **Description:** `Hot yoga priser i København. Enkelt klasse fra 299 kr. KickStarter 10 klasser 599 kr. Ubegrænset medlemskab fra 999 kr/md. Under-30 rabat.`

### Structured Data
- [ ] Add `schema-pricing.json` (OfferCatalog with all tiers)

### Content
- [ ] Comparison table (visual or text) of all pass types
- [ ] "Which pass is right for you?" decision guide
- [ ] Under-30 pricing section clearly marked
- [ ] Tourist pass highlighted for international visitors
- [ ] FAQ: "Can I share my pass?", "Is there a cancellation policy?"
- [ ] CTA to book a class or start trial

---

## Teacher Training (hotyogacph.dk/teacher-training-*)

### Meta Tags
- [ ] **Title:** `200-timers Yogalæreruddannelse — Hot Yoga Copenhagen` / `200hr Yoga Teacher Training Copenhagen`
- [ ] **Description:** `Bliv certificeret yogalærer med Yoga Alliance godkendt 200-timers uddannelse. 4-ugers intensiv eller 18-ugers fleksibel. Undervisning på engelsk i København.`

### Structured Data
- [ ] Add `schema-teacher-training.json` (EducationalOccupationalProgram + FAQPage)

### Content
- [ ] Full curriculum breakdown
- [ ] Format comparison (4w vs 8w vs 18w)
- [ ] Upcoming start dates
- [ ] Testimonials from graduates
- [ ] FAQ section (5+ questions specific to YTT)
- [ ] Yoga Alliance badge and registration number
- [ ] CTA: Apply / Start Preparation Phase

---

## FAQ Page (hotyogacph.dk/faq) — CREATE THIS PAGE

### Meta Tags
- [ ] **Title:** `Ofte Stillede Spørgsmål — Hot Yoga Copenhagen` / `FAQ — Hot Yoga Copenhagen`
- [ ] **Description:** `Svar på de mest stillede spørgsmål om hot yoga, priser, klasser og medlemskab hos Hot Yoga Copenhagen i Christianshavn.`

### Structured Data
- [ ] Add `schema-faq.json` (FAQPage with 14 questions)

### Content
- [ ] Use the 14 Q&As from schema-faq.json as page content
- [ ] Organize into sections: Getting Started, Pricing, Classes, Teacher Training, Practical Info
- [ ] Use accordion/expandable format for clean UX
- [ ] Each answer should match the schema answer exactly

---

## Private Yoga Class (hotyogacph.dk/privatehotyogaclass)

### Meta Tags
- [ ] **Title:** `Privat Yoga Klasse — Hot Yoga Copenhagen` / `Private Yoga Class — Hot Yoga Copenhagen`
- [ ] **Description:** `Book en privat yoga, hot yoga eller meditationsklasse for enkeltpersoner eller grupper. Skræddersyet undervisning i Copenhagen.`

### Content
- [ ] What's included in a private class
- [ ] Pricing (or "contact for pricing")
- [ ] Who benefits from private classes
- [ ] Booking process / CTA

---

## 21-Day Challenge (hotyogacph.dk/21dayschallenge)

### Meta Tags
- [ ] **Title:** `21-Dages Hot Yoga Udfordring — Hot Yoga Copenhagen` / `21-Day Hot Yoga Challenge — Hot Yoga Copenhagen`
- [ ] **Description:** `Tag 21-dages hot yoga udfordringen! 14 klasser på 21 dage. Vind præmier og oplev en transformation. Alle niveauer velkomne.`

### Content
- [ ] Challenge rules and how to participate
- [ ] Benefits of a 21-day practice
- [ ] Prizes and rewards
- [ ] Testimonials from past participants
- [ ] CTA to sign up

---

## Learn More (hotyogacph.dk/learnmore)

### Meta Tags
- [ ] **Title:** `Om Hot Yoga — Hot Yoga Copenhagen` / `About Hot Yoga — Hot Yoga Copenhagen`
- [ ] **Description:** `Lær mere om infraret hot yoga, vores studio i Christianshavn, og hvad der gør Hot Yoga Copenhagen unikt. Siden 2014.`

### Content
- [ ] Studio history and mission
- [ ] Infrared heating explanation
- [ ] Meet the teachers
- [ ] Studio amenities and facilities
- [ ] Community and values

---

## Cross-Page Checklist

For EVERY page:
- [ ] Unique, keyword-rich title (under 60 chars)
- [ ] Unique meta description (under 160 chars)
- [ ] One H1 tag (not duplicate across pages)
- [ ] Logical heading hierarchy (H1 → H2 → H3, no skipping)
- [ ] All images have alt text
- [ ] Internal links to 2-3 other pages
- [ ] Mobile-responsive (Framer handles this)
- [ ] Page loads under 3 seconds
- [ ] Canonical URL set (Framer auto-generates)
- [ ] Open Graph image set (1200x630px)
