# Hot Yoga Copenhagen — SEO & AEO Action Plan

## Executive Summary

Hot Yoga Copenhagen has strong brand recognition (4.9/5, 500+ reviews, operating since 2014) but significant SEO/AEO gaps that limit organic discoverability. The Framer site lacks structured data, has thin content on key pages, and misses major AEO opportunities. This plan addresses all three pillars: traditional SEO, structured data, and answer engine optimization.

**Competitors:** Dóttir Hot Yoga, Ohmyoga, Østerbro Hot Yoga Studio, Hot Yoga Hellerup
**Your advantage:** Longest-established (2014), highest-rated (4.9/5), only infrared studio, Yoga Alliance school since 2015, bilingual (DA+EN), tourist-friendly

---

## Priority 1: Structured Data (Impact: HIGH, Effort: LOW)

**Timeline: This week**

Your Framer site currently has ZERO structured data. This is the single biggest quick win.

### Actions:
1. **Add `schema-homepage.json`** to Framer homepage (LocalBusiness + AggregateRating + Offers)
2. **Add `schema-classes.json`** to Book a Class page (ExercisePlan types)
3. **Add `schema-pricing.json`** to Pricing page (OfferCatalog with all tiers)
4. **Add `schema-teacher-training.json`** to YTT pages (EducationalOccupationalProgram + FAQPage)
5. **Add `schema-faq.json`** to FAQ page or homepage (14 common questions)

**How:** In Framer, go to each page → Settings → Custom Code → "Start of `<head>` tag" → paste the script block.

**Validate:** After publishing, test each URL at https://search.google.com/test/rich-results

### Expected Results:
- Rich snippets in Google (star ratings, pricing, FAQ dropdowns)
- 2.7x more likely to be cited by AI answer engines (BrightEdge data)
- Knowledge panel eligibility for "Hot Yoga Copenhagen"

---

## Priority 2: Content Optimization for AEO (Impact: HIGH, Effort: MEDIUM)

**Timeline: 1-2 weeks**

AI answer engines (ChatGPT, Perplexity, Google AI Overviews) extract answers from well-structured content. Your current pages are visually beautiful but content-thin for AI extraction.

### 2a. Create a Dedicated FAQ Page in Framer

**Why:** FAQ schema is the #1 AEO signal. AI engines directly cite FAQ content.

**Content structure:**
- URL: `hotyogacph.dk/faq`
- 15-20 questions organized in sections:
  - **Getting Started** (what to wear, what to bring, first class tips)
  - **About Hot Yoga** (benefits, infrared vs bikram, safety)
  - **Pricing & Passes** (costs, trials, student discount, tourist pass)
  - **Teacher Training** (duration, certification, cost, formats)
  - **Practical Info** (location, parking, showers, cancellation policy)

**The FAQ content is already written** in `schema-faq.json` — use those Q&As as page content AND as schema markup.

### 2b. Expand Existing Page Content

Each Framer page should have at minimum 500-800 words of content. Currently most pages are hero + CTA with minimal text.

**Homepage** — Add sections:
- "What Makes Our Studio Different" (infrared heating, since 2014, 500+ reviews)
- "Class Types" with 2-3 sentence descriptions each
- "Getting Here" with transit directions
- Location embed (Google Maps)

**Pricing Page** — Add:
- Comparison table (clips vs membership vs time-based)
- "Which pass is right for you?" decision guide
- Under-30 pricing callout section

**Classes Page** — Add:
- 150-200 word description per class type
- "Who is this class for?" per type
- Difficulty level indicators

**Teacher Training** — This page likely has the most content already. Ensure:
- Program curriculum breakdown
- Schedule/timeline for each format
- Testimonials from graduates
- FAQ section specific to YTT

### 2c. Write Content That AI Can Extract

**Format rules for AEO:**
- Start each section with a direct answer in the first 30-60 words
- Use H2/H3 headings as questions (e.g., "How much does hot yoga cost in Copenhagen?")
- Include comparison tables and numbered lists
- Keep paragraphs to 3-4 sentences max
- Bold key facts and numbers

---

## Priority 3: Technical SEO in Framer (Impact: MEDIUM, Effort: LOW)

**Timeline: This week**

### 3a. Meta Tags Audit (Check Each Page)

Every page in Framer should have:
- **Title:** Under 60 characters, include primary keyword
- **Description:** 150-160 characters, compelling with keyword
- **OG Image:** 1200x630px branded image (not default Framer)
- **Canonical URL:** Self-referencing canonical on every page

**Recommended titles:**

| Page | Title (DA) | Title (EN) |
|------|-----------|-----------|
| Homepage | Hot Yoga Copenhagen — Infrared Yoga i Christianshavn | Hot Yoga Copenhagen — Infrared Yoga in Christianshavn |
| Classes | Yoga Klasser — Hot Yoga Copenhagen | Yoga Classes — Hot Yoga Copenhagen |
| Pricing | Priser & Medlemskab — Hot Yoga Copenhagen | Pricing & Membership — Hot Yoga Copenhagen |
| YTT | 200-timers Yogalæreruddannelse — Hot Yoga Copenhagen | 200hr Yoga Teacher Training — Hot Yoga Copenhagen |
| FAQ | Ofte Stillede Spørgsmål — Hot Yoga Copenhagen | FAQ — Hot Yoga Copenhagen |
| Private Class | Privat Yoga Klasse — Hot Yoga Copenhagen | Private Yoga Class — Hot Yoga Copenhagen |
| 21-Day Challenge | 21-Dages Yoga Udfordring — Hot Yoga Copenhagen | 21-Day Yoga Challenge — Hot Yoga Copenhagen |

### 3b. Image Alt Text

Every image in Framer should have descriptive alt text:
- Hero images: "Hot yoga class in infrared heated studio at Hot Yoga Copenhagen, Christianshavn"
- Teacher photos: "[Name], yoga teacher at Hot Yoga Copenhagen"
- Studio photos: "Infrared hot yoga studio interior, Hot Yoga Copenhagen"

### 3c. Internal Linking

Add cross-links between pages:
- Homepage → link to pricing, classes, YTT, FAQ
- Pricing → link to class descriptions, trial info
- Classes → link to booking, pricing
- YTT → link to FAQ, pricing, booking

### 3d. Sitemap Verification

Framer auto-generates `sitemap.xml`. Verify it includes all public pages:
1. Visit `hotyogacph.dk/sitemap.xml`
2. Ensure all pages are listed
3. Submit sitemap to Google Search Console

---

## Priority 4: Local SEO (Impact: HIGH, Effort: MEDIUM)

**Timeline: Ongoing**

### 4a. Google Business Profile Optimization

Your GBP is your most visible asset for local search. Optimize:

- [ ] Verify all business info is current (hours, address, phone)
- [ ] Add ALL service categories: "Hot Yoga Studio", "Yoga Studio", "Yoga Teacher", "Fitness Center"
- [ ] Upload 20+ high-quality photos (studio interior, classes in action, lounge, exterior)
- [ ] Add all products/services with pricing in GBP
- [ ] Post weekly updates (class schedule changes, events, tips)
- [ ] Respond to EVERY review within 24 hours
- [ ] Add Q&A (seed with your FAQ content)
- [ ] Enable messaging and booking links
- [ ] Add "From the business" description with keywords

### 4b. Citation Building

Ensure consistent NAP (Name, Address, Phone) across:
- [ ] Google Business Profile
- [ ] TripAdvisor (already have 500+ reviews — ensure info is current)
- [ ] Yelp Copenhagen
- [ ] Facebook Business
- [ ] Instagram Bio
- [ ] VisitCopenhagen listing
- [ ] ClassPass listing
- [ ] Apple Maps
- [ ] Krak.dk / De Gule Sider (Danish directories)
- [ ] Eniro.dk

### 4c. Review Generation

With 500+ reviews at 4.9, you're strong here. Maintain momentum:
- Add "Leave a review" link to post-class email
- QR code in studio lounge linking to Google Reviews
- Respond to every review (Google weighs responsiveness)

---

## Priority 5: AEO-Specific Strategies (Impact: HIGH, Effort: MEDIUM-HIGH)

**Timeline: 2-4 weeks**

### 5a. Create an llms.txt File

A new web standard for telling AI crawlers what your site is about. Add to your Framer site's root:

**File:** `hotyogacph.dk/llms.txt`

```
# Hot Yoga Copenhagen

> Premium infrared hot yoga studio in Christianshavn, Copenhagen, Denmark. Operating since 2014. Yoga Alliance registered school since 2015.

## About
Hot Yoga Copenhagen is Copenhagen's premier infrared hot yoga studio, located at Torvegade 66, Christianshavn. We offer 30-35 daily classes across multiple styles (Vinyasa, Power, Yin, Sculpt, Basics, Meditation, Vibro Yoga) in 30-35°C infrared-heated studios. All classes taught in English. 4.9/5 rating from 500+ reviews.

## Services
- Hot yoga classes (drop-in from 299 DKK)
- Monthly memberships (from 999 DKK/month)
- Clip cards (5-200 classes)
- Trial passes (KickStarter 599 DKK)
- Tourist passes (7 days 895 DKK)
- Private yoga classes
- 200-hour Yoga Teacher Training (Yoga Alliance RYT-200)
- 21-Day Yoga Challenge

## Location
Torvegade 66, 1400 København K, Denmark
2-minute walk from Christianshavn Metro

## Contact
Phone: +45 53 88 12 09
Email: info@hotyogacph.dk
Website: https://www.hotyogacph.dk

## Hours
Monday-Friday: 06:30-21:00
Saturday-Sunday: 08:00-18:00
```

**How to add in Framer:** You can't directly create a `.txt` file in Framer. Options:
1. Host it on Netlify at `profile.hotyogacph.dk/llms.txt` (we'll set this up)
2. Or use a Framer redirect from `/llms.txt` to the Netlify-hosted version

### 5b. Optimize for Voice Search

Voice queries are conversational. Optimize content for natural language:
- "Where can I do hot yoga in Copenhagen?"
- "How much is hot yoga in Copenhagen?"
- "What's the best yoga studio near Christianshavn?"
- "Is hot yoga good for beginners?"
- "Where to get yoga teacher certification in Copenhagen?"

Each of these should have a direct answer on your site (the FAQ covers most).

### 5c. Build Topical Authority

AI engines favor sites that demonstrate deep expertise. Create content clusters:

**Cluster 1: Hot Yoga Knowledge Hub**
- What is hot yoga? (pillar page)
- Hot yoga benefits
- Hot yoga vs regular yoga
- Hot yoga for beginners guide
- What to wear to hot yoga
- Infrared yoga explained

**Cluster 2: Copenhagen Yoga Guide**
- Best yoga studios in Copenhagen (you write it, you rank for it)
- Yoga for tourists in Copenhagen
- Copenhagen wellness guide

**Cluster 3: Yoga Teacher Training**
- How to become a yoga teacher in Denmark
- Yoga Alliance certification explained
- YTT program comparison guide
- Day in the life of a yoga teacher trainee

These can be blog posts on the Framer site or on the Netlify subdomain.

### 5d. Get Cited by AI

To appear in ChatGPT, Perplexity, and Google AI Overviews:
1. **TripAdvisor presence** — your 500+ reviews make you highly citable. Keep responding to reviews.
2. **Reddit mentions** — Perplexity heavily weights Reddit (46.7% of sources). Monitor r/copenhagen, r/yoga, r/travel for opportunities to be mentioned naturally.
3. **VisitCopenhagen** — your listing there is a strong AEO signal for tourist queries.
4. **Wikipedia/Wikidata** — consider creating a Wikidata entity for Hot Yoga Copenhagen (helps AI knowledge graphs).

---

## Priority 6: Keyword Strategy (Impact: MEDIUM, Effort: LOW)

### Target Keywords (by search intent)

**High-intent (booking/purchase):**
| Keyword (DA) | Keyword (EN) | Monthly Volume (est.) |
|--------------|-------------|----------------------|
| hot yoga københavn | hot yoga copenhagen | 500-1000 |
| yoga klasser københavn | yoga classes copenhagen | 300-500 |
| yoga medlemskab københavn | yoga membership copenhagen | 100-200 |
| yoga priser københavn | yoga prices copenhagen | 100-200 |
| yogalæreruddannelse københavn | yoga teacher training copenhagen | 50-100 |
| hot yoga prøveklasse | hot yoga trial class | 50-100 |

**Informational (AEO targets):**
| Keyword | AEO Opportunity |
|---------|----------------|
| what is hot yoga | FAQ + blog post |
| hot yoga benefits | FAQ + blog post |
| hot yoga for beginners | FAQ + classes page |
| infrared yoga vs bikram | FAQ + blog post |
| best yoga copenhagen | Local SEO + blog |
| yoga teacher training denmark | YTT page + blog |
| yoga studio christianshavn | Local SEO |

**Long-tail (voice/AI):**
- "where to do hot yoga in copenhagen"
- "how much does yoga cost in copenhagen"
- "best yoga studio for beginners in copenhagen"
- "yoga teacher certification denmark"
- "hot yoga near christianshavn metro"

---

## Priority 7: Profile Subdomain Optimization (Impact: LOW, Effort: LOW)

**Timeline: Today (done in this PR)**

`profile.hotyogacph.dk` is a member-only app. It should NOT be indexed.

### Actions (implemented in this PR):
- [x] Add `<meta name="robots" content="noindex, nofollow">` to index.html
- [x] Add `X-Robots-Tag: noindex` header in netlify.toml
- [x] Create `robots.txt` blocking all crawlers

This prevents the profile subdomain from competing with or diluting the main site's authority.

---

## Measurement & Tracking

### Set Up (if not already):
1. **Google Search Console** — verify `hotyogacph.dk`, submit sitemap
2. **Google Analytics 4** — track organic traffic, landing pages, conversions
3. **Google Business Profile Insights** — monitor local search visibility
4. **Schema validation** — monthly check via Rich Results Test

### KPIs to Track:
| Metric | Current (est.) | 3-Month Target | 6-Month Target |
|--------|---------------|----------------|----------------|
| Organic traffic (monthly) | Unknown | +30% | +60% |
| Rich snippet impressions | 0 | 500+ | 2000+ |
| AI citation mentions | Low | Appear in Perplexity | Appear in ChatGPT + Google AI |
| "Hot yoga copenhagen" ranking | Top 3 | #1 with rich snippet | #1 with knowledge panel |
| FAQ rich results | 0 | 5+ questions showing | 10+ questions showing |

---

## Quick Win Checklist (Do This Week)

- [ ] Paste all 5 JSON-LD schemas into Framer pages
- [ ] Validate schemas at Rich Results Test
- [ ] Verify Google Business Profile info is current
- [ ] Add `noindex` to profile subdomain (done in this PR)
- [ ] Submit sitemap to Google Search Console
- [ ] Create llms.txt on Netlify subdomain (done in this PR)

## Next Month

- [ ] Create FAQ page in Framer with full Q&A content
- [ ] Expand homepage content to 800+ words
- [ ] Write 2-3 blog posts for topical authority
- [ ] Build citation consistency across 10 directories
- [ ] Set up review generation workflow
