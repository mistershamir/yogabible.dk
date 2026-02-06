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
